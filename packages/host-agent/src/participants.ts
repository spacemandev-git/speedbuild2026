import { Keypair } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { BUREAU_ADMIN_BASE } from "./config.ts";
import { provisionStream, pushStreamCredentials } from "./asciinema.ts";
import { IncusClient, IncusError, validateIncusName } from "./incus.ts";
import { deliverNotice, ROOM_LABELS } from "./notifier.ts";
import { generatePassword } from "./password.ts";
import { archiveRecordings, bundleArchives, listRecordings, type RecordingInfo } from "./recordings.ts";
import type { HostAgentState, ParticipantRecord } from "./state.ts";
import { StateStore } from "./state.ts";

export const ROOMS = ["room1", "room2", "room3", "room4", "room5"] as const;
export type Room = (typeof ROOMS)[number];

export interface ParticipantView extends ParticipantRecord {
  name: string;
  sshCommand: string;
  warnings: string[];
}

export class ParticipantError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string) {
    super(message);
    this.name = "ParticipantError";
  }
}

function logStep(action: string, participant: string, detail?: string): void {
  console.log(JSON.stringify({ component: "participants", action, participant, ...(detail ? { detail } : {}) }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function validateAuthorizedKey(value: string): string {
  if (value.length > 16_384 || value.includes("\n") || value.includes("\r")) {
    throw new ParticipantError("invalid authorized key", 400);
  }
  if (!/^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/]+={0,3}(?: [^\r\n]+)?$/.test(value)) {
    throw new ParticipantError("invalid authorized key", 400, "expected a single OpenSSH public key");
  }
  return value;
}

export function participantName(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error("participant number must be between 1 and 99");
  return `p${String(n).padStart(2, "0")}`;
}

export function operativeId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error("participant number must be between 1 and 99");
  return `OPERATIVE-${String(n).padStart(2, "0")}`;
}

export function parseParticipantName(name: string): number {
  validateIncusName(name, "participant name");
  const match = /^p(\d{2})$/.exec(name);
  const n = match?.[1] ? Number(match[1]) : 0;
  if (n < 1 || n > 99) throw new ParticipantError("invalid participant name", 400, "expected p01 through p99");
  return n;
}

export function isRoom(value: string): value is Room {
  return (ROOMS as readonly string[]).includes(value);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 3_000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export class ParticipantManager {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: Config,
    private readonly incus: IncusClient,
    private readonly stateStore: StateStore,
  ) {}

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private sshCommand(record: ParticipantRecord): string {
    return `ssh operative@${this.config.hostLanHint} -p ${record.sshPort}`;
  }

  private view(name: string, record: ParticipantRecord, warnings: string[] = []): ParticipantView {
    return { name, ...record, sshCommand: this.sshCommand(record), warnings };
  }

  private selectNumber(state: HostAgentState, requestedName?: string): number {
    if (requestedName !== undefined) {
      const requested = parseParticipantName(requestedName);
      if (requested > this.config.participantCount) {
        throw new ParticipantError("participant number exceeds configured capacity", 400);
      }
      if (state.participants[participantName(requested)]) {
        throw new ParticipantError("participant already exists", 409);
      }
      return requested;
    }
    for (let n = 1; n <= this.config.participantCount; n += 1) {
      if (!state.participants[participantName(n)]) return n;
    }
    throw new ParticipantError("participant capacity reached", 409);
  }

  private async waitForRunning(name: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const instance = (await this.incus.list()).find((candidate) => candidate.name === name);
      if (instance?.status?.toLowerCase() === "running") return;
      await Bun.sleep(500);
    }
    throw new Error(`timed out waiting for ${name} to run`);
  }

  // In VM tenant mode an instance reports "running" before its incus-agent is
  // up, so exec/file-push race and fail. Poll a trivial exec until it succeeds.
  // Containers satisfy this on the first probe, so it is cheap in both modes.
  private async waitForAgent(name: string, timeoutMs = 180_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      try {
        await this.incus.exec(name, ["true"]);
        return;
      } catch (error) {
        lastError = errorMessage(error);
        await Bun.sleep(1_000);
      }
    }
    throw new Error(`timed out waiting for ${name} agent readiness: ${lastError}`);
  }

  private async operativeUid(name: string): Promise<number> {
    const output = await this.incus.exec(name, ["id", "-u", "operative"]);
    if (!/^\d+$/.test(output)) throw new Error(`invalid operative uid returned by ${name}`);
    return Number(output);
  }

  private async configureIdentity(name: string, record: ParticipantRecord, warnings: string[]): Promise<void> {
    logStep("set-password", name);
    await this.incus.exec(name, ["chpasswd"], { input: `operative:${record.password}\n` });
    const uid = await this.operativeUid(name);

    logStep("push-solana-keypair", name);
    await this.incus.exec(name, ["install", "-d", "-m", "0700", "-o", "operative", "-g", "operative", "/home/operative/.config/solana"]);
    await this.incus.filePushContent(
      `${JSON.stringify(record.solanaSecretKey)}\n`,
      name,
      "/home/operative/.config/solana/id.json",
      0o600,
      uid,
    );
    await this.incus.exec(name, ["chown", "operative:operative", "/home/operative/.config/solana/id.json"]);

    logStep("push-bureau-env", name);
    const environment = [
      `export OPERATIVE_ID=${shellQuote(record.operativeId)}`,
      "export SOLANA_KEYPAIR=/home/operative/.config/solana/id.json",
      // Shared OpenRouter key powering the default OpenCode model
      // (openai/gpt-5.6-sol) and the alternative z-ai/glm-5.2 entry in
      // opencode.json. Only emitted when configured on the host.
      ...(this.config.sunburstOrKey
        ? [`export SUNBURST_OR_KEY=${shellQuote(this.config.sunburstOrKey)}`]
        : []),
      "",
    ].join("\n");
    await this.incus.filePushContent(environment, name, "/home/operative/.bureau-env", 0o600, uid);
    await this.incus.exec(name, ["chown", "operative:operative", "/home/operative/.bureau-env"]);

    const guideSource = join(this.config.contentDir, "PLAYERS_GUIDE.md");
    try {
      const guide = await readFile(guideSource, "utf8");
      logStep("push-players-guide", name);
      await this.incus.filePushContent(guide, name, "/home/operative/PLAYERS_GUIDE.md", 0o644, uid);
      await this.incus.exec(name, ["chown", "operative:operative", "/home/operative/PLAYERS_GUIDE.md"]);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      const warning = `players guide source missing: ${guideSource}`;
      warnings.push(warning);
      logStep("push-players-guide-skipped", name, warning);
    }

    if (record.authorizedKey) {
      logStep("push-authorized-key", name);
      await this.incus.exec(name, ["install", "-d", "-m", "0700", "-o", "operative", "-g", "operative", "/home/operative/.ssh"]);
      await this.incus.filePushContent(`${record.authorizedKey}\n`, name, "/home/operative/.ssh/authorized_keys", 0o600, uid);
      await this.incus.exec(name, ["chown", "operative:operative", "/home/operative/.ssh/authorized_keys"]);
    }
  }

  private async createContainer(name: string, record: ParticipantRecord, warnings: string[]): Promise<void> {
    logStep("copy-template", name);
    await this.incus.copy("p-template", name);
    logStep("set-static-ip", name, record.ip);
    await this.incus.deviceOverride(name, "eth0", "ipv4.address", record.ip);
    logStep("start", name);
    await this.incus.start(name);
    await this.waitForRunning(name);
    await this.waitForAgent(name);
    await this.configureIdentity(name, record, warnings);
    logStep("add-ssh-proxy", name, String(record.sshPort));
    await this.incus.deviceAdd(name, `ssh-${name}`, record.sshPort);
  }

  private async registerOperative(record: ParticipantRecord, warnings: string[]): Promise<void> {
    logStep("register-operative", participantName(record.n));
    try {
      const response = await fetchWithTimeout(`${BUREAU_ADMIN_BASE}/operatives`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ operativeId: record.operativeId, pubkey: record.solanaPubkey }),
      });
      if (!response.ok) throw new Error(`bureau-api returned ${response.status}`);
    } catch (error) {
      warnings.push(`bureau-api operative registration failed: ${errorMessage(error)}`);
    }
  }

  private async deregisterOperative(record: ParticipantRecord, warnings: string[]): Promise<void> {
    logStep("deregister-operative", participantName(record.n));
    try {
      const response = await fetchWithTimeout(
        `${BUREAU_ADMIN_BASE}/operatives/${encodeURIComponent(record.operativeId)}`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${this.config.adminToken}`,
          },
        },
      );
      if (!response.ok && response.status !== 404) throw new Error(`bureau-api returned ${response.status}`);
    } catch (error) {
      warnings.push(`bureau-api operative deregistration failed: ${errorMessage(error)}`);
    }
  }

  private async provisionStreamToken(name: string, record: ParticipantRecord, warnings: string[]): Promise<void> {
    logStep("provision-asciinema", name);
    try {
      const stream = await provisionStream(this.incus, name, name);
      record.asciinemaToken = stream.publicToken;
      record.installId = stream.installId;
      record.producerToken = stream.producerToken;
      record.playerWsPath = stream.playerWsPath;
    } catch (error) {
      warnings.push(`asciinema token provisioning failed: ${errorMessage(error)}`);
    }
  }

  async provision(requestedName?: string, authorizedKey?: string): Promise<ParticipantView> {
    return this.mutate(async () => {
      const state = await this.stateStore.load();
      const n = this.selectNumber(state, requestedName);
      const name = participantName(n);
      const keypair = Keypair.generate();
      const validatedAuthorizedKey = authorizedKey === undefined ? undefined : validateAuthorizedKey(authorizedKey);
      const record: ParticipantRecord = {
        n,
        operativeId: operativeId(n),
        ip: `${this.config.subnetPrefix}.${100 + n}`,
        sshPort: this.config.sshPortBase + n,
        password: generatePassword(),
        solanaPubkey: keypair.publicKey.toBase58(),
        solanaSecretKey: Array.from(keypair.secretKey),
        ...(validatedAuthorizedKey ? { authorizedKey: validatedAuthorizedKey } : {}),
        asciinemaToken: null,
        installId: null,
        producerToken: null,
        playerWsPath: null,
        revealedRooms: [],
        createdAt: new Date().toISOString(),
        status: "Running",
      };
      const warnings: string[] = [];
      try {
        await this.createContainer(name, record, warnings);
        await this.registerOperative(record, warnings);
        await this.provisionStreamToken(name, record, warnings);
        state.participants[name] = record;
        await this.stateStore.save(state);
      } catch (error) {
        logStep("rollback", name, errorMessage(error));
        await this.incus.delete(name, true).catch(() => undefined);
        throw error;
      }
      logStep("provisioned", name);
      return this.view(name, record, warnings);
    });
  }

  async list(): Promise<ParticipantView[]> {
    const [state, instances] = await Promise.all([this.stateStore.load(), this.incus.list()]);
    const statuses = new Map(instances.map((instance) => [instance.name, instance.status ?? "Unknown"]));
    return Object.entries(state.participants)
      .sort(([, left], [, right]) => left.n - right.n)
      .map(([name, record]) => this.view(name, { ...record, status: statuses.get(name) ?? "Missing" }));
  }

  async get(name: string): Promise<ParticipantView> {
    parseParticipantName(name);
    const [state, instances] = await Promise.all([this.stateStore.load(), this.incus.list()]);
    const record = state.participants[name];
    if (!record) throw new ParticipantError("participant not found", 404);
    const live = instances.find((instance) => instance.name === name);
    return this.view(name, { ...record, status: live?.status ?? "Missing" });
  }

  async recordings(name: string): Promise<{ name: string; recordings: RecordingInfo[] }> {
    await this.get(name);
    return { name, recordings: await listRecordings(this.incus, name) };
  }

  async recordingsArchive(name: string): Promise<{ filename: string; bytes: Uint8Array }> {
    await this.get(name);
    const recordings = await listRecordings(this.incus, name);
    if (recordings.length === 0) {
      throw new ParticipantError("no recordings", 404, `${name} has no session recordings`);
    }
    return { filename: `${name}-recordings.tar.gz`, bytes: await archiveRecordings(this.incus, name) };
  }

  async recordingsArchiveAll(): Promise<{ filename: string; bytes: Uint8Array }> {
    const participants = await this.list();
    const entries: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const participant of participants) {
      try {
        const recordings = await listRecordings(this.incus, participant.name);
        if (recordings.length === 0) continue;
        entries.push({ name: participant.name, bytes: await archiveRecordings(this.incus, participant.name) });
      } catch {
        // Best-effort: skip boxes that are stopped or unreachable rather than failing the whole export.
        continue;
      }
    }
    if (entries.length === 0) {
      throw new ParticipantError("no recordings", 404, "no participant has session recordings");
    }
    return { filename: "bureau-recordings.tar", bytes: await bundleArchives(entries) };
  }

  private async pushRoom(name: string, room: Room): Promise<void> {
    const source = join(this.config.contentDir, "rooms", room, "/");
    const destination = `/home/operative/bureau/rooms/${room}/`;
    logStep("push-room", name, room);
    await this.incus.filePush(source, name, destination, { recursive: true });
    await this.incus.exec(name, ["chown", "-R", "operative:operative", destination]);
  }

  private async notifyReveal(record: ParticipantRecord, room: Room, warnings: string[]): Promise<void> {
    try {
      const response = await fetchWithTimeout(`${BUREAU_ADMIN_BASE}/reveal`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ operativeId: record.operativeId, room }),
      });
      if (!response.ok) throw new Error(`bureau-api returned ${response.status}`);
    } catch (error) {
      warnings.push(`bureau-api reveal failed: ${errorMessage(error)}`);
    }
  }

  private async deliverRoomNotice(name: string, room: Room, warnings: string[]): Promise<void> {
    try {
      const brief = await readFile(join(this.config.contentDir, "rooms", room, "BRIEF.md"), "utf8");
      const text = [
        "=== BUREAU NOTIFICATION ===",
        `${ROOM_LABELS[room] ?? room} — ROOM REVEALED`,
        `Brief installed at ~/bureau/rooms/${room}/BRIEF.md`,
        "",
        brief,
      ].join("\n");
      logStep("deliver-room-notice", name, room);
      await deliverNotice(this.incus.exec.bind(this.incus), name, text);
    } catch (error) {
      warnings.push(`room notice delivery failed: ${errorMessage(error)}`);
    }
  }

  async reveal(name: string, room: Room): Promise<ParticipantView> {
    return this.mutate(async () => {
      parseParticipantName(name);
      const state = await this.stateStore.load();
      const record = state.participants[name];
      if (!record) throw new ParticipantError("participant not found", 404);
      const warnings: string[] = [];
      // The room brief is a convenience file; a push failure must not block the
      // bureau-api reveal for this operative.
      try {
        await this.pushRoom(name, room);
        await this.deliverRoomNotice(name, room, warnings);
      } catch (error) {
        warnings.push(`room brief push failed: ${errorMessage(error)}`);
      }
      await this.notifyReveal(record, room, warnings);
      record.revealedRooms = [...new Set([...record.revealedRooms, room])];
      await this.stateStore.save(state);
      return this.view(name, record, warnings);
    });
  }

  async suspend(name: string): Promise<ParticipantView> {
    return this.setRunning(name, false);
  }

  async resume(name: string): Promise<ParticipantView> {
    return this.setRunning(name, true);
  }

  private async setRunning(name: string, running: boolean): Promise<ParticipantView> {
    return this.mutate(async () => {
      parseParticipantName(name);
      const state = await this.stateStore.load();
      const record = state.participants[name];
      if (!record) throw new ParticipantError("participant not found", 404);
      logStep(running ? "resume" : "suspend", name);
      if (running) {
        await this.incus.start(name);
        await this.waitForRunning(name);
        record.status = "Running";
      } else {
        await this.incus.stop(name);
        record.status = "Stopped";
      }
      await this.stateStore.save(state);
      return this.view(name, record);
    });
  }

  async reset(name: string): Promise<ParticipantView> {
    return this.mutate(async () => {
      parseParticipantName(name);
      const state = await this.stateStore.load();
      const record = state.participants[name];
      if (!record) throw new ParticipantError("participant not found", 404);
      const rooms = [...record.revealedRooms].filter(isRoom);
      const warnings: string[] = [];
      logStep("reset-delete", name);
      await this.incus.deviceRemove(name, `ssh-${name}`).catch((error: unknown) => {
        if (!(error instanceof IncusError)) throw error;
      });
      await this.incus.delete(name, true);
      try {
        await this.createContainer(name, record, warnings);
        if (record.installId && record.asciinemaToken) {
          try {
            await pushStreamCredentials(this.incus, name, record.installId, record.asciinemaToken);
          } catch (error) {
            warnings.push(`asciinema credential restore failed: ${errorMessage(error)}`);
          }
        }
        await this.registerOperative(record, warnings);
        for (const room of rooms) {
          await this.pushRoom(name, room);
          await this.deliverRoomNotice(name, room, warnings);
          await this.notifyReveal(record, room, warnings);
        }
        record.status = "Running";
        await this.stateStore.save(state);
      } catch (error) {
        record.status = "Reset failed";
        await this.stateStore.save(state);
        throw error;
      }
      return this.view(name, record, warnings);
    });
  }

  async remove(name: string): Promise<{ name: string; removed: true; warnings: string[] }> {
    return this.mutate(async () => {
      parseParticipantName(name);
      const state = await this.stateStore.load();
      const record = state.participants[name];
      if (!record) throw new ParticipantError("participant not found", 404);
      const warnings: string[] = [];
      logStep("remove-proxy", name);
      await this.incus.deviceRemove(name, `ssh-${name}`).catch((error: unknown) => {
        if (!(error instanceof IncusError)) throw error;
      });
      logStep("remove-container", name);
      await this.incus.delete(name, true);
      await this.deregisterOperative(record, warnings);
      delete state.participants[name];
      await this.stateStore.save(state);
      return { name, removed: true, warnings };
    });
  }
}
