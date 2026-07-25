import { env } from '$env/dynamic/private';

const HOST_AGENT_BASE = env.SB_HOST_AGENT_URL ?? 'http://10.61.0.1:7000';
const BUREAU_ADMIN_BASE = env.SB_BUREAU_ADMIN_URL ?? 'http://10.61.0.20:8710';
const BUREAU_PUBLIC_BASE = env.SB_BUREAU_PUBLIC_URL ?? 'http://10.61.0.20:8700';

export type ParticipantRecord = {
  name: string;
  operativeId?: string;
  ip?: string;
  ipAddress?: string;
  sshPort?: number;
  ssh_port?: number;
  status?: string;
  password?: string;
  sshPassword?: string;
  sshCommand?: string;
  publicKey?: string;
  pubkey?: string;
  walletPublicKey?: string;
  solanaPubkey?: string;
  streamToken?: string | null;
  asciinemaToken?: string | null;
  revealed?: Array<number | string>;
  revealedRooms?: Array<number | string>;
  warnings?: string[];
  warning?: string;
  [key: string]: unknown;
};

export type RecordingInfo = { file: string; size: number };

export type ZoneHealth = {
  name: string;
  status?: string;
  ip?: string;
  services?: Record<string, { active?: boolean; status?: string } | string | boolean | null>;
  healthy?: boolean;
  [key: string]: unknown;
};

export type BureauEvent = {
  id?: number;
  ts: string | number;
  type: string;
  room?: string | number;
  operativeId?: string;
  message?: string;
  data?: unknown;
};

export type RoomState = {
  status: string;
  detail?: unknown;
  [key: string]: unknown;
};

export type OperativeProgress = {
  operativeId: string;
  rooms: Record<string, RoomState>;
  [key: string]: unknown;
};

export type LockRecord = {
  room: 'room1' | 'room2';
  lock: number;
  members: string[];
  liveOperative: string;
  liveCode: string;
};

export type LocksPayload = {
  pool: number;
  locks: LockRecord[];
};

export type BureauState = {
  operatives: OperativeProgress[];
  reveals?: unknown[];
  roomState?: unknown[];
  recentEvents?: BureauEvent[];
  roomsComplete?: string[];
  locks?: LockRecord[] | LocksPayload;
  room5Scoreboard?: unknown[];
  [key: string]: unknown;
};

type UnlockResult = {
  ok: boolean;
  combo?: string;
  fragment?: string;
  event?: BureauEvent;
};

type FetchOptions = Omit<RequestInit, 'body'> & { body?: unknown };

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown
  ) {
    super(message);
  }
}

function required(name: 'SB_HOST_AGENT_TOKEN' | 'SB_ADMIN_TOKEN'): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

async function request<T>(base: string, token: string, path: string, options: FetchOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('accept', 'application/json');

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${base}${path}`, { ...options, headers, body });
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new UpstreamError(`Upstream ${response.status}: ${detail || response.statusText}`, response.status, payload);
  }

  return payload as T;
}

function normalizeParticipants(payload: ParticipantRecord[] | { participants?: ParticipantRecord[] }): ParticipantRecord[] {
  return Array.isArray(payload) ? payload : (payload.participants ?? []);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function normalizeBureauState(payload: unknown): BureauState {
  const raw = objectValue(payload) ?? {};
  const normalized = new Map<string, OperativeProgress>();

  const ensureOperative = (operativeId: string): OperativeProgress => {
    const existing = normalized.get(operativeId);
    if (existing) return existing;
    const operative: OperativeProgress = { operativeId, rooms: {} };
    normalized.set(operativeId, operative);
    return operative;
  };

  if (Array.isArray(raw.operatives)) {
    for (const item of raw.operatives) {
      const row = objectValue(item);
      const operativeId = row && stringValue(row.operativeId, row.operative_id);
      if (!row || !operativeId) continue;

      const rooms: Record<string, RoomState> = {};
      const rawRooms = objectValue(row.rooms);
      if (rawRooms) {
        for (const [room, value] of Object.entries(rawRooms)) {
          const state = objectValue(value);
          rooms[room] = state && typeof state.status === 'string'
            ? ({ ...state, status: state.status } as RoomState)
            : { status: typeof value === 'string' ? value : 'unknown', detail: value };
        }
      }
      const room1Status = stringValue(row.room1Status, row.room1_status);
      if (room1Status) rooms.room1 = { status: room1Status };
      normalized.set(operativeId, { ...row, operativeId, rooms } as OperativeProgress);
    }
  }

  if (Array.isArray(raw.reveals)) {
    for (const item of raw.reveals) {
      const row = objectValue(item);
      const operativeId = row && stringValue(row.operativeId, row.operative_id);
      const room = row && stringValue(row.room);
      if (!row || !operativeId || !room) continue;
      const operative = ensureOperative(operativeId);
      operative.rooms[room] ??= { status: 'revealed', detail: row };
    }
  }

  if (Array.isArray(raw.roomState)) {
    for (const item of raw.roomState) {
      const row = objectValue(item);
      const operativeId = row && stringValue(row.operativeId, row.operative_id);
      const room = row && stringValue(row.room);
      if (!row || !operativeId || !room) continue;
      const operative = ensureOperative(operativeId);
      const current = operative.rooms[room];
      const value = row.value;
      const valueObject = objectValue(value);
      const details = objectValue(current?.detail) ?? {};
      const detail = { ...details, [stringValue(row.key) ?? 'state']: value };
      // The `status` room_state key is the room's own solve marker. Reading it back off
      // the accumulated detail keeps it authoritative no matter which key lands last.
      const status = stringValue(
        detail.status,
        valueObject?.status,
        current?.status,
        'in-progress'
      )!;
      // A marshal force-completion outranks whatever status the room was in.
      operative.rooms[room] = {
        status: detail.forced === true ? 'force-completed' : status,
        detail
      };
    }
  }

  return { ...raw, operatives: [...normalized.values()] } as BureauState;
}

function roomId(room: number): string {
  return `room${room}`;
}

export const hostAgent = {
  async zones(): Promise<ZoneHealth[] | Record<string, ZoneHealth>> {
    return request(HOST_AGENT_BASE, required('SB_HOST_AGENT_TOKEN'), '/zones');
  },

  async participants(): Promise<ParticipantRecord[]> {
    const payload = await request<ParticipantRecord[] | { participants?: ParticipantRecord[] }>(
      HOST_AGENT_BASE,
      required('SB_HOST_AGENT_TOKEN'),
      '/participants'
    );
    return normalizeParticipants(payload);
  },

  participant(name: string): Promise<ParticipantRecord> {
    return request(HOST_AGENT_BASE, required('SB_HOST_AGENT_TOKEN'), `/participants/${encodeSegment(name)}`);
  },

  recordings(name: string): Promise<{ name: string; recordings: RecordingInfo[] }> {
    return request(HOST_AGENT_BASE, required('SB_HOST_AGENT_TOKEN'), `/participants/${encodeSegment(name)}/recordings`);
  },

  provision(name?: string): Promise<ParticipantRecord> {
    return request(HOST_AGENT_BASE, required('SB_HOST_AGENT_TOKEN'), '/participants', {
      method: 'POST',
      body: name ? { name } : {}
    });
  },

  control(name: string, operation: 'suspend' | 'resume' | 'reset'): Promise<ParticipantRecord> {
    return request(
      HOST_AGENT_BASE,
      required('SB_HOST_AGENT_TOKEN'),
      `/participants/${encodeSegment(name)}/${operation}`,
      { method: 'POST' }
    );
  },

  reveal(name: string, room: number): Promise<unknown> {
    return request(HOST_AGENT_BASE, required('SB_HOST_AGENT_TOKEN'), `/participants/${encodeSegment(name)}/reveal`, {
      method: 'POST',
      body: { room: roomId(room) }
    });
  },

  remove(name: string): Promise<unknown> {
    return request(HOST_AGENT_BASE, required('SB_HOST_AGENT_TOKEN'), `/participants/${encodeSegment(name)}`, {
      method: 'DELETE'
    });
  }
};

export const bureauAdmin = {
  async state(): Promise<BureauState> {
    const payload = await request<unknown>(
      BUREAU_ADMIN_BASE,
      required('SB_ADMIN_TOKEN'),
      '/state'
    );
    return normalizeBureauState(payload);
  },

  locks(): Promise<LocksPayload> {
    return request(BUREAU_ADMIN_BASE, required('SB_ADMIN_TOKEN'), '/locks');
  },

  override(operativeId: string, room: number): Promise<UnlockResult> {
    return request(BUREAU_ADMIN_BASE, required('SB_ADMIN_TOKEN'), '/override', {
      method: 'POST',
      body: { operativeId, room: roomId(room) }
    });
  },

  forceComplete(operativeId: string, room: number): Promise<UnlockResult> {
    return request(BUREAU_ADMIN_BASE, required('SB_ADMIN_TOKEN'), '/force-complete', {
      method: 'POST',
      body: { operativeId, room: roomId(room) }
    });
  },

  completeRoom(room: number): Promise<{ ok: boolean; room: string }> {
    return request(
      BUREAU_ADMIN_BASE,
      required('SB_ADMIN_TOKEN'),
      `/rooms/${encodeSegment(roomId(room))}/complete`,
      { method: 'POST' }
    );
  }
};

export const bureauPublic = {
  configureRoom3(config: { participants: string[]; selected: string[] }): Promise<{ ok: boolean; configured: boolean }> {
    return request(BUREAU_PUBLIC_BASE, required('SB_ADMIN_TOKEN'), '/fragment/config', {
      method: 'POST',
      body: { participants: config.participants, bought: config.selected }
    });
  }
};

export function fetchBureauEvents(signal?: AbortSignal): Promise<Response> {
  return fetch(`${BUREAU_ADMIN_BASE}/events`, {
    headers: {
      accept: 'text/event-stream',
      authorization: `Bearer ${required('SB_ADMIN_TOKEN')}`
    },
    signal
  });
}

export function fetchRecordingArchive(name: string): Promise<Response> {
  return fetch(`${HOST_AGENT_BASE}/participants/${encodeSegment(name)}/recordings/archive`, {
    headers: { authorization: `Bearer ${required('SB_HOST_AGENT_TOKEN')}` }
  });
}

export function fetchAllRecordingsArchive(): Promise<Response> {
  return fetch(`${HOST_AGENT_BASE}/recordings/archive`, {
    headers: { authorization: `Bearer ${required('SB_HOST_AGENT_TOKEN')}` }
  });
}
