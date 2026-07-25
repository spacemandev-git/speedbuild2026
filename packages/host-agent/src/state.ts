import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ParticipantRecord {
  n: number;
  operativeId: string;
  ip: string;
  sshPort: number;
  password: string;
  solanaPubkey: string;
  solanaSecretKey: number[];
  authorizedKey?: string;
  asciinemaToken?: string | null;
  installId?: string | null;
  producerToken?: string | null;
  playerWsPath?: string | null;
  revealedRooms: string[];
  createdAt: string;
  status?: string;
}

export interface HostAgentState {
  participants: Record<string, ParticipantRecord>;
}

export const EMPTY_STATE: HostAgentState = {
  participants: {},
};

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class StateStore {
  constructor(readonly path: string) {}

  async load(): Promise<HostAgentState> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return structuredClone(EMPTY_STATE);
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("state file is not an object");
    const value = parsed as Partial<HostAgentState>;
    if (typeof value.participants !== "object" || value.participants === null) {
      throw new Error("state file has an invalid shape");
    }
    const participants = Object.fromEntries(
      Object.entries(value.participants).map(([name, record]) => {
        if (typeof record !== "object" || record === null) {
          throw new Error("state file has an invalid participant record");
        }
        const cleanRecord = { ...record } as Record<string, unknown>;
        delete cleanRecord.apiKeyIndex;
        delete cleanRecord.apiKey;
        return [name, cleanRecord as unknown as ParticipantRecord] as const;
      }),
    );
    return { participants };
  }

  async save(state: HostAgentState): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp-${process.pid}-${crypto.randomUUID()}`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
  }
}
