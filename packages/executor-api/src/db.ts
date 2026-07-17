import { Database } from "bun:sqlite";

export interface ClaimantRow {
  claim_number: string;
  pubkey: string;
  tribute_ata: string | null;
  probate_nonce: string;
  room1_status: string;
  created_at: string;
}

export interface StoredEventRow {
  id: number;
  ts: string;
  type: string;
  room: string | null;
  claim_number: string | null;
  message: string;
  data: string;
}

export class EstateDatabase {
  readonly sqlite: Database;

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true, strict: true });
    this.migrate();
  }

  private migrate(): void {
    this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS claimants (
        claim_number TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        tribute_ata TEXT,
        probate_nonce TEXT NOT NULL,
        room1_status TEXT NOT NULL DEFAULT 'UNPROVEN',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teams (
        name TEXT PRIMARY KEY,
        registrar_key TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reveals (
        claim_number TEXT NOT NULL,
        room TEXT NOT NULL,
        revealed_at TEXT NOT NULL,
        PRIMARY KEY (claim_number, room)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        room TEXT,
        claim_number TEXT,
        message TEXT NOT NULL,
        data JSON NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS room_state (
        claim_number TEXT NOT NULL,
        room TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (claim_number, room, key)
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_reveals_room ON reveals(room, claim_number);
    `);
  }

  upsertClaimant(claimNumber: string, pubkey: string, probateNonce: string): void {
    this.sqlite.query(`
      INSERT INTO claimants(claim_number, pubkey, probate_nonce, room1_status, created_at)
      VALUES (?, ?, ?, 'UNPROVEN', ?)
      ON CONFLICT(claim_number) DO UPDATE SET
        pubkey = excluded.pubkey,
        probate_nonce = excluded.probate_nonce
    `).run(claimNumber, pubkey, probateNonce, new Date().toISOString());
  }

  updateClaimRecord(claimNumber: string, tributeAta: string, probateNonce: string, status: number): void {
    this.sqlite.query(`
      UPDATE claimants SET tribute_ata = ?, probate_nonce = ?, room1_status = ?
      WHERE claim_number = ?
    `).run(tributeAta, probateNonce, status === 1 ? "PROVEN" : "UNPROVEN", claimNumber);
  }

  markRoom1Proven(claimNumber: string): void {
    this.sqlite.query("UPDATE claimants SET room1_status = 'PROVEN' WHERE claim_number = ?")
      .run(claimNumber);
  }

  getClaimant(claimNumber: string): ClaimantRow | null {
    return this.sqlite.query("SELECT * FROM claimants WHERE claim_number = ?")
      .get(claimNumber) as ClaimantRow | null;
  }

  listClaimants(): ClaimantRow[] {
    return this.sqlite.query("SELECT * FROM claimants ORDER BY claim_number").all() as ClaimantRow[];
  }

  listRoom1WatchCandidates(): ClaimantRow[] {
    return this.sqlite.query(`
      SELECT c.* FROM claimants c
      INNER JOIN reveals r ON r.claim_number = c.claim_number AND r.room = 'room1'
      WHERE c.room1_status != 'PROVEN'
      ORDER BY c.claim_number
    `).all() as ClaimantRow[];
  }

  reveal(claimNumber: string, room: string): boolean {
    const result = this.sqlite.query(`
      INSERT OR IGNORE INTO reveals(claim_number, room, revealed_at) VALUES (?, ?, ?)
    `).run(claimNumber, room, new Date().toISOString());
    return result.changes > 0;
  }

  listReveals(): Array<{ claim_number: string; room: string; revealed_at: string }> {
    return this.sqlite.query("SELECT * FROM reveals ORDER BY revealed_at")
      .all() as Array<{ claim_number: string; room: string; revealed_at: string }>;
  }

  setRoomState(claimNumber: string, room: string, key: string, value: unknown): void {
    this.sqlite.query(`
      INSERT INTO room_state(claim_number, room, key, value) VALUES (?, ?, ?, ?)
      ON CONFLICT(claim_number, room, key) DO UPDATE SET value = excluded.value
    `).run(claimNumber, room, key, JSON.stringify(value));
  }

  getRoomState(claimNumber: string, room: string, key: string): string | null {
    const row = this.sqlite.query(`
      SELECT value FROM room_state WHERE claim_number = ? AND room = ? AND key = ?
    `).get(claimNumber, room, key) as { value: string } | null;
    return row?.value ?? null;
  }

  listRoomState(): Array<{ claim_number: string; room: string; key: string; value: string }> {
    return this.sqlite.query("SELECT * FROM room_state ORDER BY claim_number, room, key")
      .all() as Array<{ claim_number: string; room: string; key: string; value: string }>;
  }

  insertEvent(event: Omit<StoredEventRow, "id">): number {
    const result = this.sqlite.query(`
      INSERT INTO events(ts, type, room, claim_number, message, data) VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.ts, event.type, event.room, event.claim_number, event.message, event.data);
    return Number(result.lastInsertRowid);
  }

  recentEvents(limit = 50): StoredEventRow[] {
    return this.sqlite.query(`
      SELECT * FROM (SELECT * FROM events ORDER BY id DESC LIMIT ?) ORDER BY id ASC
    `).all(limit) as StoredEventRow[];
  }

  listTeams(): Array<{ name: string; registrar_key: string }> {
    return this.sqlite.query("SELECT * FROM teams ORDER BY name")
      .all() as Array<{ name: string; registrar_key: string }>;
  }

  close(): void {
    this.sqlite.close();
  }
}
