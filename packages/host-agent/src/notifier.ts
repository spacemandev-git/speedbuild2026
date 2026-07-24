export interface ExecutorEvent {
  id: number;
  type: string;
  room: string | null;
  claimNumber: string | null;
  message: string;
  data: Record<string, unknown>;
}

export interface NotifyTarget {
  claimNumber: string;
  text: string;
}

export interface NotifierDeps {
  eventsUrl: string;
  stateUrl: string;
  adminToken: string;
  incusExec: (container: string, argv: string[], opts: { input: string }) => Promise<unknown>;
  loadParticipants: () => Promise<Record<string, { claimNumber: string }>>;
  readCursor: () => Promise<number | null>;
  writeCursor: (id: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  log?: (entry: Record<string, unknown>) => void;
}

const ROOM_LABELS: Record<string, string> = {
  room1: "CLAUSE I · Provenance",
  room2: "CLAUSE II · The Vault Wing",
  room3: "CLAUSE III · The Residual",
  room4: "CLAUSE IV · The Deed",
  room5: "CLAUSE V · The Route",
  bonus: "Bonus Duties",
};

const DELIVERY_SCRIPT = `set -u
inbox="/home/claimant/estate/inbox.md"
mkdir -p /home/claimant/estate
msg="$(cat)"
printf '\n%s\n' "$msg" >> "$inbox"
chown -R claimant:claimant /home/claimant/estate 2>/dev/null || true
printf '%s\n' "$msg" | wall -n 2>/dev/null || printf '%s\n' "$msg" | wall 2>/dev/null || true`;

export function formatNotice(opts: {
  room: string | null;
  headline: string;
  message: string;
  unlockLabel?: string;
  unlock?: string;
}): string {
  const roomLabel = opts.room === null ? "Estate" : (ROOM_LABELS[opts.room] ?? "Estate");
  const lines = [
    "═══ ESTATE NOTICE ═══",
    `${roomLabel} — ${opts.headline}`,
    opts.message,
  ];
  if (opts.unlock) lines.push(`${opts.unlockLabel ?? "Unlock"}: ${opts.unlock}`);
  return lines.join("\n");
}

function noticeTarget(
  claimNumber: string,
  opts: Parameters<typeof formatNotice>[0],
): NotifyTarget {
  return { claimNumber, text: formatNotice(opts) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function resolveDirectTargets(event: ExecutorEvent): NotifyTarget[] {
  if (
    event.type === "combo.reveal"
    && (event.room === "room1" || event.room === "room2")
    && typeof event.claimNumber === "string"
  ) {
    return [noticeTarget(event.claimNumber, {
      room: event.room,
      headline: "SATISFIED",
      message: event.message,
      unlockLabel: "Combination",
      unlock: String(event.data.combo),
    })];
  }

  if (
    event.type === "combo.reveal"
    && event.room === "room4"
    && typeof event.data.claim === "string"
  ) {
    return [noticeTarget(event.data.claim, {
      room: "room4",
      headline: "SATISFIED",
      message: event.message,
      unlockLabel: "Deed code",
      unlock: String(event.data.deedCode),
    })];
  }

  if (
    event.type === "room5.route-complete"
    && typeof event.data.claim === "string"
  ) {
    return [noticeTarget(event.data.claim, {
      room: "room5",
      headline: "ROUTE RECONSTRUCTED",
      message: event.message,
    })];
  }

  if (event.type === "combo.reveal" && event.room === "room3" && isPlainObject(event.data.unlocks)) {
    return Object.entries(event.data.unlocks).flatMap(([claimNumber, fragment]) => {
      if (typeof fragment !== "string") return [];
      return [noticeTarget(claimNumber, {
        room: "room3",
        headline: "SATISFIED",
        message: event.message,
        unlockLabel: "Fragment",
        unlock: fragment,
      })];
    });
  }

  if (event.type === "mercy.granted" && typeof event.claimNumber === "string") {
    const combo = typeof event.data.combo === "string" ? event.data.combo : undefined;
    const fragment = combo === undefined && typeof event.data.fragment === "string"
      ? event.data.fragment
      : undefined;
    const unlock = combo ?? fragment;
    const opts: Parameters<typeof formatNotice>[0] = {
      room: event.room,
      headline: "MERCY GRANTED",
      message: event.message,
    };
    if (unlock !== undefined) {
      opts.unlock = unlock;
      opts.unlockLabel = combo !== undefined ? "Combination" : "Fragment";
    }
    return [noticeTarget(event.claimNumber, opts)];
  }

  if (event.type === "bonus.task-complete" && typeof event.claimNumber === "string") {
    return [noticeTarget(event.claimNumber, {
      room: event.room,
      headline: "DUTY RECORDED",
      message: event.message,
    })];
  }

  return [];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function validEvent(value: unknown, frameId: number | null): ExecutorEvent | null {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === "number" ? value.id : frameId;
  if (
    id === null
    || !Number.isFinite(id)
    || typeof value.type !== "string"
    || (value.room !== null && typeof value.room !== "string")
    || (value.claimNumber !== null && typeof value.claimNumber !== "string")
    || typeof value.message !== "string"
    || !isPlainObject(value.data)
  ) return null;
  return {
    id,
    type: value.type,
    room: value.room,
    claimNumber: value.claimNumber,
    message: value.message,
    data: value.data,
  };
}

export class EstateNotifier {
  private readonly fetcher: typeof fetch;
  private readonly log: (entry: Record<string, unknown>) => void;
  private cursor: number | null = null;
  private cursorInitialized = false;
  private seedMode = false;
  private seedMax: number | null = null;
  private stopped = false;
  private abortController: AbortController | null = null;
  private loopPromise: Promise<void> | undefined;

  constructor(private readonly deps: NotifierDeps) {
    this.fetcher = deps.fetchImpl ?? fetch;
    this.log = deps.log ?? ((entry) => console.log(JSON.stringify({ component: "notify", ...entry })));
  }

  start(): void {
    try {
      if (this.loopPromise) return;
      this.stopped = false;
      this.abortController = new AbortController();
      this.loopPromise = this.connectLoop()
        .catch((error: unknown) => this.log({ component: "notify", error }))
        .finally(() => {
          this.loopPromise = undefined;
        });
    } catch (error) {
      this.log({ component: "notify", error });
    }
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
  }

  async handleEvent(event: ExecutorEvent): Promise<void> {
    await this.initializeCursor(false);
    if (this.cursor !== null && event.id <= this.cursor) return;

    const targets = resolveDirectTargets(event);

    if (targets.length > 0) {
      const participants = await this.deps.loadParticipants();
      for (const target of targets) {
        const container = Object.entries(participants).find(([, participant]) => {
          return participant.claimNumber === target.claimNumber;
        })?.[0];
        if (!container) {
          this.log({ component: "notify", skip: "unknown-claim", claimNumber: target.claimNumber });
          continue;
        }
        try {
          await this.deps.incusExec(container, ["bash", "-c", DELIVERY_SCRIPT], { input: target.text });
        } catch (error) {
          this.log({ component: "notify", error, container, claimNumber: target.claimNumber });
        }
      }
    }

    this.cursor = event.id;
    await this.deps.writeCursor(event.id);
  }

  private async initializeCursor(forStart: boolean): Promise<void> {
    if (!this.cursorInitialized) {
      this.cursor = await this.deps.readCursor();
      this.cursorInitialized = true;
    }
    if (forStart && this.cursor === null) this.seedMode = true;
  }

  private async finalizeSeed(): Promise<void> {
    this.seedMode = false;
    if (this.seedMax === null) return;
    this.cursor = this.seedMax;
    await this.deps.writeCursor(this.seedMax);
  }

  private async processFrame(frame: string): Promise<void> {
    const lines = frame.split(/\r?\n/);
    if (lines.some((line) => line.startsWith(":"))) {
      if (this.seedMode) await this.finalizeSeed();
      return;
    }

    let frameId: number | null = null;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("id:")) {
        const parsed = Number(line.slice(3).trim());
        if (Number.isFinite(parsed)) frameId = parsed;
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch (error) {
      this.log({ component: "notify", error, skip: "invalid-event-json" });
      return;
    }
    const event = validEvent(parsed, frameId);
    if (!event) {
      this.log({ component: "notify", skip: "invalid-event" });
      return;
    }
    if (this.seedMode) {
      this.seedMax = Math.max(this.seedMax ?? event.id, event.id);
      return;
    }
    await this.handleEvent(event);
  }

  private async waitForReconnect(milliseconds: number): Promise<void> {
    if (this.stopped) return;
    const signal = this.abortController?.signal;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async connectLoop(): Promise<void> {
    try {
      await this.initializeCursor(true);
    } catch (error) {
      this.cursorInitialized = true;
      this.seedMode = true;
      this.log({ component: "notify", error, phase: "read-cursor" });
    }

    let backoff = 1_000;
    while (!this.stopped) {
      let sawFrame = false;
      try {
        const response = await this.fetcher(this.deps.eventsUrl, {
          headers: { Authorization: `Bearer ${this.deps.adminToken}` },
          signal: this.abortController?.signal ?? null,
        });
        if (!response.ok) throw new Error(`executor events request failed with status ${response.status}`);
        if (!response.body) throw new Error("executor events response had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!this.stopped) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          let boundary = /\r?\n\r?\n/.exec(buffer);
          while (boundary) {
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            if (!sawFrame) {
              sawFrame = true;
              backoff = 1_000;
            }
            await this.processFrame(frame);
            boundary = /\r?\n\r?\n/.exec(buffer);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) await this.processFrame(buffer);
        if (this.seedMode && this.seedMax !== null) await this.finalizeSeed();
      } catch (error) {
        if (!this.stopped && !isAbortError(error)) {
          this.log({ component: "notify", error, phase: "event-stream" });
        }
      }

      if (this.stopped) break;
      await this.waitForReconnect(backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}
