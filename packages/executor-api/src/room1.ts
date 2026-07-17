import { createHash } from "node:crypto";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import type { EstateChain } from "./chain.ts";
import type { EstateDatabase, ClaimantRow } from "./db.ts";
import type { EventHub } from "./events.ts";
import { fourDigit } from "./combos.ts";

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export interface Room1Requirements {
  amount: bigint;
  memo: string;
}

export interface Room1Evaluation {
  matched: boolean;
  nearMiss: boolean;
  diagnostics: Record<string, unknown>;
}

export function deriveRoom1Requirements(claimNumber: string, probateNonce: bigint): Room1Requirements {
  const nonceBytes = Buffer.alloc(8);
  nonceBytes.writeBigUInt64LE(probateNonce);
  return {
    amount: 1_000n + (probateNonce % 9_000n),
    memo: createHash("sha256")
      .update(Buffer.from(claimNumber, "utf8"))
      .update(nonceBytes)
      .digest("hex")
      .slice(0, 16),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function publicKeyText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof PublicKey) return value.toBase58();
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.pubkey === "string") return record.pubkey;
  if (record.pubkey instanceof PublicKey) return record.pubkey.toBase58();
  return null;
}

function memoText(instruction: Record<string, unknown>): string | null {
  if (typeof instruction.parsed === "string") return instruction.parsed;
  const parsed = asRecord(instruction.parsed);
  if (parsed && typeof parsed.memo === "string") return parsed.memo;
  if (typeof instruction.data === "string") {
    try { return Buffer.from(bs58.decode(instruction.data)).toString("utf8"); } catch { return null; }
  }
  return null;
}

export function evaluateRoom1Transaction(
  transaction: unknown,
  claimantPubkey: string,
  tributeAta: string,
  requirements: Room1Requirements,
): Room1Evaluation {
  const root = asRecord(transaction);
  const tx = asRecord(root?.transaction);
  const message = asRecord(tx?.message);
  const meta = asRecord(root?.meta);
  const accountKeys = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
  const claimantSigned = accountKeys.some((key) => {
    const record = asRecord(key);
    return record?.signer === true && publicKeyText(key) === claimantPubkey;
  });
  const topLevel = Array.isArray(message?.instructions) ? message.instructions : [];
  const innerGroups = Array.isArray(meta?.innerInstructions) ? meta.innerInstructions : [];
  const inner = innerGroups.flatMap((group) => {
    const record = asRecord(group);
    return Array.isArray(record?.instructions) ? record.instructions : [];
  });
  const instructions = [...topLevel, ...inner].map(asRecord).filter((item): item is Record<string, unknown> => item !== null);

  let destinationSeen = false;
  let claimantTransferSeen = false;
  let actualAmount: bigint | null = null;
  for (const instruction of instructions) {
    const parsed = asRecord(instruction.parsed);
    const info = asRecord(parsed?.info);
    if (!info || (parsed?.type !== "transfer" && parsed?.type !== "transferChecked")) continue;
    if (publicKeyText(info.destination) !== tributeAta) continue;
    destinationSeen = true;
    const authority = publicKeyText(info.authority) ?? publicKeyText(info.owner);
    if (authority !== claimantPubkey) continue;
    claimantTransferSeen = true;
    const tokenAmount = asRecord(info.tokenAmount);
    const rawAmount = tokenAmount?.amount ?? info.amount;
    if (typeof rawAmount === "string" || typeof rawAmount === "number") {
      try { actualAmount = BigInt(rawAmount); } catch { actualAmount = null; }
    }
  }

  const memos = instructions
    .filter((instruction) => publicKeyText(instruction.programId) === MEMO_PROGRAM_ID || instruction.program === "spl-memo")
    .map(memoText)
    .filter((memo): memo is string => memo !== null);
  const amountMatches = actualAmount === requirements.amount;
  const memoMatches = memos.includes(requirements.memo);
  const matched = claimantSigned && claimantTransferSeen && amountMatches && memoMatches;
  return {
    matched,
    nearMiss: !matched && claimantTransferSeen,
    diagnostics: {
      destinationSeen,
      claimantTransferSeen,
      claimantSigned,
      expectedAmount: requirements.amount.toString(),
      actualAmount: actualAmount?.toString() ?? null,
      expectedMemo: requirements.memo,
      observedMemos: memos,
      amountMatches,
      memoMatches,
    },
  };
}

export interface Room1WatcherOptions {
  pollIntervalMs?: number;
  retryBaseMs?: number;
}

export class Room1Watcher {
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly subscriptions = new Map<string, number>();
  private readonly processed = new Map<string, Set<string>>();
  private running = false;
  private failures = 0;
  private readonly pollIntervalMs: number;
  private readonly retryBaseMs: number;

  constructor(
    private readonly db: EstateDatabase,
    private readonly chain: EstateChain,
    private readonly events: EventHub,
    private readonly estateSecret: string,
    options: Room1WatcherOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000;
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
  }

  start(): void {
    this.stopped = false;
    void this.tick();
  }

  private schedule(delay: number): void {
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      for (const claimant of this.db.listRoom1WatchCandidates()) await this.watchAndPoll(claimant);
      this.failures = 0;
      this.schedule(this.pollIntervalMs);
    } catch (error) {
      this.failures += 1;
      const delay = Math.min(this.pollIntervalMs, this.retryBaseMs * (2 ** Math.min(this.failures - 1, 4)));
      console.warn(`[room1] chain unavailable; retrying in ${delay}ms: ${error instanceof Error ? error.message : String(error)}`);
      this.schedule(delay);
    } finally {
      this.running = false;
    }
  }

  private async resolveClaimant(row: ClaimantRow): Promise<ClaimantRow | null> {
    const record = await this.chain.getClaimRecord(row.claim_number);
    if (!record) return null;
    this.db.updateClaimRecord(row.claim_number, record.tributeAta, record.probateNonce.toString(), record.status);
    if (record.status === 1) return null;
    return this.db.getClaimant(row.claim_number);
  }

  private async watchAndPoll(initial: ClaimantRow): Promise<void> {
    const claimant = await this.resolveClaimant(initial);
    if (!claimant?.tribute_ata) return;
    if (!this.subscriptions.has(claimant.claim_number)) {
      const subscription = this.chain.connection.onAccountChange(
        new PublicKey(claimant.tribute_ata),
        () => { void this.scanClaimant(claimant).catch((error) => console.warn(`[room1] websocket scan failed: ${String(error)}`)); },
        "confirmed",
      );
      this.subscriptions.set(claimant.claim_number, subscription);
    }
    await this.scanClaimant(claimant);
  }

  private async scanClaimant(claimant: ClaimantRow): Promise<void> {
    if (!claimant.tribute_ata || this.db.getClaimant(claimant.claim_number)?.room1_status === "PROVEN") return;
    const address = new PublicKey(claimant.tribute_ata);
    const signatures = await this.chain.connection.getSignaturesForAddress(address, { limit: 25 }, "confirmed");
    const seen = this.processed.get(claimant.claim_number) ?? new Set<string>();
    this.processed.set(claimant.claim_number, seen);
    for (const entry of [...signatures].reverse()) {
      if (seen.has(entry.signature) || entry.err) continue;
      seen.add(entry.signature);
      const transaction = await this.chain.connection.getParsedTransaction(entry.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction) continue;
      const requirements = deriveRoom1Requirements(claimant.claim_number, BigInt(claimant.probate_nonce));
      const result = evaluateRoom1Transaction(transaction, claimant.pubkey, claimant.tribute_ata, requirements);
      if (result.matched) {
        const chainSignature = await this.chain.markProven(claimant.claim_number);
        this.db.markRoom1Proven(claimant.claim_number);
        const message = `${claimant.claim_number}: tribute received. Provenance: confirmed. Instruments released.`;
        this.events.emit({
          type: "room1.proven", room: "room1", claimNumber: claimant.claim_number, message,
          data: { tributeSignature: entry.signature, markProvenSignature: chainSignature },
        });
        this.events.emit({
          type: "combo.reveal", room: "room1", claimNumber: claimant.claim_number, message,
          data: { combo: fourDigit(claimant.claim_number, "room1", this.estateSecret) },
        });
        return;
      }
      if (result.nearMiss) {
        this.events.emit({
          type: "room1.rejected", room: "room1", claimNumber: claimant.claim_number,
          message: `${claimant.claim_number}: tribute rejected.`,
          data: { signature: entry.signature, ...result.diagnostics },
        });
      }
    }
    if (seen.size > 250) {
      const keep = new Set(Array.from(seen).slice(-100));
      this.processed.set(claimant.claim_number, keep);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled(Array.from(this.subscriptions.values()).map(
      (id) => this.chain.connection.removeAccountChangeListener(id),
    ));
    this.subscriptions.clear();
  }
}
