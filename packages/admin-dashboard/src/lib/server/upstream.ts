import { env } from '$env/dynamic/private';

const HOST_AGENT_BASE = env.SB_HOST_AGENT_URL ?? 'http://10.61.0.1:7000';
const EXECUTOR_ADMIN_BASE = env.SB_EXECUTOR_ADMIN_URL ?? 'http://10.61.0.20:8710';

export type ParticipantRecord = {
  name: string;
  claimNumber?: string;
  claim_number?: string;
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
  apiKey?: string;
  estateApiKey?: string;
  streamToken?: string | null;
  asciinemaToken?: string | null;
  revealed?: Array<number | string>;
  revealedRooms?: Array<number | string>;
  warnings?: string[];
  warning?: string;
  [key: string]: unknown;
};

export type ZoneHealth = {
  name: string;
  status?: string;
  ip?: string;
  services?: Record<string, { active?: boolean; status?: string } | string | boolean | null>;
  healthy?: boolean;
  [key: string]: unknown;
};

export type EstateEvent = {
  ts: string | number;
  type: string;
  room?: string | number;
  claimNumber?: string;
  message: string;
  data?: unknown;
};

export type RoomState = {
  status: string;
  detail?: unknown;
  [key: string]: unknown;
};

export type ClaimantState = {
  claimNumber: string;
  rooms: Record<string, RoomState>;
  [key: string]: unknown;
};

export type EstateState = {
  claimants: ClaimantState[];
  [key: string]: unknown;
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

function normalizeState(payload: unknown): EstateState {
  const raw = objectValue(payload) ?? {};
  const normalized = new Map<string, ClaimantState>();

  const ensureClaimant = (claimNumber: string): ClaimantState => {
    const existing = normalized.get(claimNumber);
    if (existing) return existing;
    const claimant: ClaimantState = { claimNumber, rooms: {} };
    normalized.set(claimNumber, claimant);
    return claimant;
  };

  if (Array.isArray(raw.claimants)) {
    for (const item of raw.claimants) {
      const row = objectValue(item);
      const claimNumber = row && stringValue(row.claimNumber, row.claim_number);
      if (!row || !claimNumber) continue;

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
      if (typeof row.room1_status === 'string') rooms.room1 = { status: row.room1_status };
      normalized.set(claimNumber, { ...row, claimNumber, rooms } as ClaimantState);
    }
  }

  if (Array.isArray(raw.reveals)) {
    for (const item of raw.reveals) {
      const row = objectValue(item);
      const claimNumber = row && stringValue(row.claimNumber, row.claim_number);
      const room = row && stringValue(row.room);
      if (!row || !claimNumber || !room) continue;
      const claimant = ensureClaimant(claimNumber);
      claimant.rooms[room] ??= { status: 'revealed', detail: row };
    }
  }

  if (Array.isArray(raw.roomState)) {
    for (const item of raw.roomState) {
      const row = objectValue(item);
      const claimNumber = row && stringValue(row.claimNumber, row.claim_number);
      const room = row && stringValue(row.room);
      if (!row || !claimNumber || !room) continue;
      const claimant = ensureClaimant(claimNumber);
      const current = claimant.rooms[room];
      const value = row.value;
      const valueObject = objectValue(value);
      const status = stringValue(
        valueObject?.status,
        row.key === 'status' ? value : undefined,
        current?.status,
        'in-progress'
      )!;
      const details = objectValue(current?.detail) ?? {};
      claimant.rooms[room] = {
        status,
        detail: { ...details, [stringValue(row.key) ?? 'state']: value }
      };
    }
  }

  return { ...raw, claimants: [...normalized.values()] } as EstateState;
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

export const executorAdmin = {
  async state(): Promise<EstateState> {
    const payload = await request<unknown>(
      EXECUTOR_ADMIN_BASE,
      required('SB_ADMIN_TOKEN'),
      '/state'
    );
    return normalizeState(payload);
  },

  mercy(claimNumber: string, room: number): Promise<{ combo?: string; fragment?: string; [key: string]: unknown }> {
    return request(EXECUTOR_ADMIN_BASE, required('SB_ADMIN_TOKEN'), '/mercy', {
      method: 'POST',
      body: { claimNumber, room: roomId(room) }
    });
  }
};

export function fetchExecutorEvents(signal?: AbortSignal): Promise<Response> {
  return fetch(`${EXECUTOR_ADMIN_BASE}/events`, {
    headers: {
      accept: 'text/event-stream',
      authorization: `Bearer ${required('SB_ADMIN_TOKEN')}`
    },
    signal
  });
}
