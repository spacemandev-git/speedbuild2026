import type { BureauDatabase, StoredEventRow } from "./db.ts";

export interface BureauEvent {
  type: string;
  message: string;
  room?: string | null;
  operativeId?: string | null;
  data?: Record<string, unknown>;
}

export interface PersistedBureauEvent extends BureauEvent {
  id: number;
  ts: string;
}

const encoder = new TextEncoder();

function parseRow(row: StoredEventRow): PersistedBureauEvent {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    data = { malformed: row.data };
  }
  return {
    id: row.id,
    ts: row.ts,
    type: row.type,
    room: row.room,
    operativeId: row.operative_id,
    message: row.message,
    data,
  };
}

function sse(event: PersistedBureauEvent): Uint8Array {
  return encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export class EventHub {
  private readonly clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  constructor(private readonly db: BureauDatabase) {}

  emit(event: BureauEvent): PersistedBureauEvent {
    const ts = new Date().toISOString();
    const id = this.db.insertEvent({
      ts,
      type: event.type,
      room: event.room ?? null,
      operative_id: event.operativeId ?? null,
      message: event.message,
      data: JSON.stringify(event.data ?? {}),
    });
    const persisted: PersistedBureauEvent = { ...event, id, ts, data: event.data ?? {} };
    const payload = sse(persisted);
    for (const controller of this.clients) {
      try {
        controller.enqueue(payload);
      } catch {
        this.clients.delete(controller);
      }
    }
    return persisted;
  }

  stream(history = 50, signal?: AbortSignal): ReadableStream<Uint8Array> {
    let activeController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        activeController = controller;
        for (const row of this.db.recentEvents(history)) controller.enqueue(sse(parseRow(row)));
        controller.enqueue(encoder.encode(": bureau event stream connected\n\n"));
        this.clients.add(controller);
        // Keep the connection non-idle so Bun.serve's idleTimeout can't reset a
        // quiet long-poll (comment frames are ignored by SSE clients).
        heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(": ping\n\n")); }
          catch { if (heartbeat) clearInterval(heartbeat); this.clients.delete(controller); }
        }, 5_000);
        signal?.addEventListener("abort", () => {
          if (heartbeat) clearInterval(heartbeat);
          this.clients.delete(controller);
          try { controller.close(); } catch { /* already closed */ }
        }, { once: true });
      },
      cancel: () => {
        if (heartbeat) clearInterval(heartbeat);
        if (activeController) this.clients.delete(activeController);
      },
    });
  }
}
