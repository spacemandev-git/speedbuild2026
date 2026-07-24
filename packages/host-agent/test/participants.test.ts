import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/config.ts";
import type { IncusClient } from "../src/incus.ts";
import { operativeId, ParticipantManager, participantName, ROOMS } from "../src/participants.ts";
import { generatePassword, PASSWORD_WORDS } from "../src/password.ts";
import type { HostAgentState, ParticipantRecord } from "../src/state.ts";
import type { StateStore } from "../src/state.ts";

describe("participant identity derivation", () => {
  test("derives padded container names and operative ids", () => {
    expect(participantName(1)).toBe("p01");
    expect(participantName(30)).toBe("p30");
    expect(operativeId(1)).toBe("OPERATIVE-01");
    expect(operativeId(30)).toBe("OPERATIVE-30");
  });

  test("rejects numbers outside the two-digit participant range", () => {
    expect(() => participantName(0)).toThrow();
    expect(() => operativeId(100)).toThrow();
  });

  test("supports the five standard rooms", () => {
    expect(ROOMS).toEqual(["room1", "room2", "room3", "room4", "room5"]);
  });

  test("provisions Bureau identity files, registers the operative, and uses Bureau paths", async () => {
    const contentDir = await mkdtemp(join(tmpdir(), "host-agent-participants-"));
    await mkdir(join(contentDir, "rooms", "room1"), { recursive: true });
    await mkdir(join(contentDir, "rooms", "room2"), { recursive: true });
    await writeFile(join(contentDir, "PLAYERS_GUIDE.md"), "# Participant guide\n");
    await writeFile(join(contentDir, "rooms", "room1", "BRIEF.md"), "# Room one brief\nBuild the thing.\n");
    await writeFile(join(contentDir, "rooms", "room2", "BRIEF.md"), "# Room two brief\nTest the thing.\n");
    const config: Config = {
      hostAgentToken: "host-token",
      adminToken: "admin-token",
      subnetPrefix: "10.61.0",
      sshPortBase: 2200,
      participantCount: 30,
      statePath: "/tmp/state.json",
      contentDir,
      hostLanHint: "192.0.2.10",
      sunburstOrKey: "or-key",
    };
    let state: HostAgentState = { participants: {}, apiKeysAssigned: [] };
    const pushedContent: Array<{
      content: string;
      destination: string;
      mode: number | undefined;
      uid: number | undefined;
    }> = [];
    const pushedFiles: Array<{ source: string; destination: string }> = [];
    const execCalls: Array<{ container: string; command: readonly string[]; input: string | undefined }> = [];
    const passwordInputs: string[] = [];
    let failRoomNotice = false;
    const incus = {
      async exec(container: string, command: readonly string[], options: { input?: string } = {}): Promise<string> {
        execCalls.push({ container, command, input: options.input });
        if (options.input) passwordInputs.push(options.input);
        if (failRoomNotice && command[0] === "bash" && command[2]?.includes('inbox="/home/operative/bureau/inbox.md"')) {
          throw new Error("wall unavailable");
        }
        if (container === "inference") return "api-key-01";
        if (container === "admin") {
          return "123e4567-e89b-42d3-a456-426614174000 AbCdEf0123456789 zYxWvU9876543210";
        }
        if (command[0] === "id") return "1000";
        if (command[0] === "bash" && command[2]?.includes("base64")) {
          return Buffer.from("recording").toString("base64");
        }
        if (command[0] === "bash") return "operative-session.cast\t9";
        return "";
      },
      async list(): Promise<Array<{ name: string; status: string }>> {
        return [
          { name: "p01", status: "Running" },
          { name: "p02", status: "Running" },
        ];
      },
      async copy(): Promise<string> { return ""; },
      async deviceOverride(): Promise<string> { return ""; },
      async start(): Promise<string> { return ""; },
      async deviceAdd(): Promise<string> { return ""; },
      async delete(): Promise<string> { return ""; },
      async filePushContent(
        content: string,
        _container: string,
        destination: string,
        mode?: number,
        uid?: number,
      ): Promise<string> {
        pushedContent.push({ content, destination, mode, uid });
        return "";
      },
      async filePush(source: string, _container: string, destination: string): Promise<string> {
        pushedFiles.push({ source, destination });
        return "";
      },
    } as unknown as IncusClient;
    const stateStore = {
      async load(): Promise<HostAgentState> {
        return structuredClone(state);
      },
      async save(next: HostAgentState): Promise<void> {
        state = structuredClone(next);
      },
    } as unknown as StateStore;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const manager = new ParticipantManager(config, incus, stateStore);
      const participant = await manager.provision("p01");
      expect(participant.operativeId).toBe("OPERATIVE-01");
      expect(participant.sshCommand).toBe("ssh operative@192.0.2.10 -p 2201");
      expect(passwordInputs[0]).toStartWith("operative:");

      const environment = pushedContent.find((entry) => entry.destination.endsWith(".bureau-env"));
      expect(environment?.destination).toBe("/home/operative/.bureau-env");
      expect(environment?.content).toContain("export BUREAU_API_KEY='api-key-01'");
      expect(environment?.content).toContain("export OPERATIVE_ID='OPERATIVE-01'");
      expect(environment?.content).toContain("export SOLANA_KEYPAIR=/home/operative/.config/solana/id.json");
      expect(environment?.content).toContain("export SUNBURST_OR_KEY='or-key'");
      expect(pushedContent).toContainEqual({
        content: "# Participant guide\n",
        destination: "/home/operative/PLAYERS_GUIDE.md",
        mode: 0o644,
        uid: 1000,
      });
      expect(execCalls.some((call) => {
        return call.container === "p01"
          && call.command.join(" ") === "chown operative:operative /home/operative/PLAYERS_GUIDE.md";
      })).toBeTrue();
      expect(requests[0]).toEqual({
        url: "http://10.61.0.20:8710/operatives",
        body: { operativeId: "OPERATIVE-01", pubkey: participant.solanaPubkey },
      });

      await manager.reveal("p01", "room1");
      expect(pushedFiles).toContainEqual({
        source: join(contentDir, "rooms", "room1", "/"),
        destination: "/home/operative/bureau/rooms/room1/",
      });
      const roomNotice = execCalls.find((call) => {
        return call.container === "p01"
          && call.command[0] === "bash"
          && call.command[2]?.includes('inbox="/home/operative/bureau/inbox.md"');
      });
      expect(roomNotice?.input).toContain("Room 1 — Operation — ROOM REVEALED");
      expect(roomNotice?.input).toContain("# Room one brief\nBuild the thing.");
      expect(requests[1]).toEqual({
        url: "http://10.61.0.20:8710/reveal",
        body: { operativeId: "OPERATIVE-01", room: "room1" },
      });

      failRoomNotice = true;
      const failedNoticeReveal = await manager.reveal("p01", "room2");
      expect(failedNoticeReveal.warnings).toContain("room notice delivery failed: wall unavailable");
      failRoomNotice = false;

      await unlink(join(contentDir, "PLAYERS_GUIDE.md"));
      const missingGuideParticipant = await manager.provision("p02");
      expect(missingGuideParticipant.warnings).toContain(
        `players guide source missing: ${join(contentDir, "PLAYERS_GUIDE.md")}`,
      );

      const archive = await manager.recordingsArchiveAll();
      expect(archive.filename).toBe("bureau-recordings.tar");
      expect(archive.bytes.byteLength).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(contentDir, { recursive: true, force: true });
    }
  });
});

describe("password generation", () => {
  test("uses four words from the embedded wordlist", () => {
    expect(PASSWORD_WORDS.length).toBeGreaterThanOrEqual(190);
    expect(PASSWORD_WORDS.length).toBeLessThanOrEqual(210);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const words = generatePassword().split("-");
      expect(words).toHaveLength(4);
      expect(words.every((word) => (PASSWORD_WORDS as readonly string[]).includes(word))).toBeTrue();
    }
  });
});

describe("participant removal", () => {
  const config: Config = {
    hostAgentToken: "host-token",
    adminToken: "admin-token",
    subnetPrefix: "10.61.0",
    sshPortBase: 2200,
    participantCount: 30,
    statePath: "/tmp/state.json",
    contentDir: "/opt/content",
    hostLanHint: "192.0.2.10",
  };
  const record: ParticipantRecord = {
    n: 1,
    operativeId: "OPERATIVE/01",
    ip: "10.61.0.101",
    sshPort: 2201,
    password: "alpha-bravo-charlie-delta",
    solanaPubkey: "pubkey",
    solanaSecretKey: [],
    apiKeyIndex: 1,
    apiKey: "api-key-01",
    revealedRooms: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "Running",
  };

  function removalHarness(): {
    manager: ParticipantManager;
    deleted: string[];
    state: () => HostAgentState;
  } {
    let state: HostAgentState = {
      participants: { p01: structuredClone(record) },
      apiKeysAssigned: [record.apiKeyIndex],
    };
    const deleted: string[] = [];
    const incus = {
      async deviceRemove(): Promise<string> { return ""; },
      async delete(name: string): Promise<string> {
        deleted.push(name);
        return "";
      },
    } as unknown as IncusClient;
    const stateStore = {
      async load(): Promise<HostAgentState> {
        return structuredClone(state);
      },
      async save(next: HostAgentState): Promise<void> {
        state = structuredClone(next);
      },
    } as unknown as StateStore;
    return {
      manager: new ParticipantManager(config, incus, stateStore),
      deleted,
      state: () => state,
    };
  }

  test("deregisters the operative after deleting the participant box", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string | undefined; authorization: string | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const harness = removalHarness();
      const result = await harness.manager.remove("p01");

      expect(requests).toEqual([{
        url: "http://10.61.0.20:8710/operatives/OPERATIVE%2F01",
        method: "DELETE",
        authorization: "Bearer admin-token",
      }]);
      expect(harness.deleted).toEqual(["p01"]);
      expect(harness.state().participants.p01).toBeUndefined();
      expect(result).toEqual({ name: "p01", removed: true, warnings: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("still removes the participant and warns when deregistration fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(null, { status: 500 });
    }) as typeof fetch;

    try {
      const harness = removalHarness();
      const result = await harness.manager.remove("p01");

      expect(harness.deleted).toEqual(["p01"]);
      expect(harness.state().participants.p01).toBeUndefined();
      expect(harness.state().apiKeysAssigned).toEqual([]);
      expect(result.warnings).toEqual([
        "bureau-api operative deregistration failed: bureau-api returned 500",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not warn when the operative is already gone", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    try {
      const harness = removalHarness();
      const result = await harness.manager.remove("p01");

      expect(harness.deleted).toEqual(["p01"]);
      expect(harness.state().participants.p01).toBeUndefined();
      expect(result.warnings).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
