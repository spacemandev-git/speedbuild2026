import { Database } from "bun:sqlite";

export interface OperativeRow {
  operative_id: string;
  pubkey: string;
  clearance_ata: string | null;
  clearance_nonce: string;
  room1_status: string;
  created_at: string;
}

export interface StoredEventRow {
  id: number;
  ts: string;
  type: string;
  room: string | null;
  operative_id: string | null;
  message: string;
  data: string;
}

export class BureauDatabase {
  readonly sqlite: Database;

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true, strict: true });
    this.migrate();
  }

  private migrate(): void {
    this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS operatives (
        operative_id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        clearance_ata TEXT,
        clearance_nonce TEXT NOT NULL,
        room1_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reveals (
        operative_id TEXT NOT NULL,
        room TEXT NOT NULL,
        revealed_at TEXT NOT NULL,
        PRIMARY KEY (operative_id, room)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        room TEXT,
        operative_id TEXT,
        message TEXT NOT NULL,
        data JSON NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS room_state (
        operative_id TEXT NOT NULL,
        room TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (operative_id, room, key)
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_reveals_room ON reveals(room, operative_id);
    `);
  }

  upsertOperative(operativeId: string, pubkey: string, clearanceNonce: string): void {
    this.sqlite.query(`
      INSERT INTO operatives(operative_id, pubkey, clearance_nonce, room1_status, created_at)
      VALUES (?, ?, ?, 'UNVERIFIED', ?)
      ON CONFLICT(operative_id) DO UPDATE SET
        pubkey = excluded.pubkey,
        clearance_nonce = excluded.clearance_nonce
    `).run(operativeId, pubkey, clearanceNonce, new Date().toISOString());
  }

  updateVerificationRecord(operativeId: string, clearanceAta: string, clearanceNonce: string, status: number): void {
    this.sqlite.query(`
      UPDATE operatives SET clearance_ata = ?, clearance_nonce = ?, room1_status = ?
      WHERE operative_id = ?
    `).run(clearanceAta, clearanceNonce, status === 1 ? "VERIFIED" : "UNVERIFIED", operativeId);
  }

  markRoom1Verified(operativeId: string): void {
    this.sqlite.query("UPDATE operatives SET room1_status = 'VERIFIED' WHERE operative_id = ?")
      .run(operativeId);
  }

  getOperative(operativeId: string): OperativeRow | null {
    return this.sqlite.query("SELECT * FROM operatives WHERE operative_id = ?")
      .get(operativeId) as OperativeRow | null;
  }

  listOperatives(): OperativeRow[] {
    return this.sqlite.query("SELECT * FROM operatives ORDER BY operative_id").all() as OperativeRow[];
  }

  listRoom1WatchCandidates(): OperativeRow[] {
    // Watch every unverified operative, including those without a recorded
    // Room 1 reveal. Exact nonce-derived payment and memo matching provide the
    // verification gate even when reveal delivery occurred out of band.
    return this.sqlite.query(`
      SELECT * FROM operatives
      WHERE room1_status != 'VERIFIED'
      ORDER BY operative_id
    `).all() as OperativeRow[];
  }

  reveal(operativeId: string, room: string): boolean {
    const result = this.sqlite.query(`
      INSERT OR IGNORE INTO reveals(operative_id, room, revealed_at) VALUES (?, ?, ?)
    `).run(operativeId, room, new Date().toISOString());
    return result.changes > 0;
  }

  listReveals(): Array<{ operative_id: string; room: string; revealed_at: string }> {
    return this.sqlite.query("SELECT * FROM reveals ORDER BY revealed_at")
      .all() as Array<{ operative_id: string; room: string; revealed_at: string }>;
  }

  setRoomState(operativeId: string, room: string, key: string, value: unknown): void {
    this.sqlite.query(`
      INSERT INTO room_state(operative_id, room, key, value) VALUES (?, ?, ?, ?)
      ON CONFLICT(operative_id, room, key) DO UPDATE SET value = excluded.value
    `).run(operativeId, room, key, JSON.stringify(value));
  }

  getRoomState(operativeId: string, room: string, key: string): string | null {
    const row = this.sqlite.query(`
      SELECT value FROM room_state WHERE operative_id = ? AND room = ? AND key = ?
    `).get(operativeId, room, key) as { value: string } | null;
    return row?.value ?? null;
  }

  listRoomState(): Array<{ operative_id: string; room: string; key: string; value: string }> {
    return this.sqlite.query("SELECT * FROM room_state ORDER BY operative_id, room, key")
      .all() as Array<{ operative_id: string; room: string; key: string; value: string }>;
  }

  markRoomComplete(room: string): void {
    this.setRoomState("*", room, "complete", true);
  }

  listCompletedRooms(): string[] {
    const rows = this.sqlite.query(`
      SELECT room FROM room_state
      WHERE operative_id = '*' AND key = 'complete'
      ORDER BY room
    `).all() as Array<{ room: string }>;
    return rows.map((row) => row.room);
  }

  insertEvent(event: Omit<StoredEventRow, "id">): number {
    const result = this.sqlite.query(`
      INSERT INTO events(ts, type, room, operative_id, message, data) VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.ts, event.type, event.room, event.operative_id, event.message, event.data);
    return Number(result.lastInsertRowid);
  }

  recentEvents(limit = 50): StoredEventRow[] {
    return this.sqlite.query(`
      SELECT * FROM (SELECT * FROM events ORDER BY id DESC LIMIT ?) ORDER BY id ASC
    `).all(limit) as StoredEventRow[];
  }

  close(): void {
    this.sqlite.close();
  }
}
