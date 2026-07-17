import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { Hono, type Context } from "hono";
import type { AppContext } from "./context.ts";
import type { ClaimantRow } from "./db.ts";
import { evaluateRoom1Transaction } from "./room1.ts";

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export const BONUS_TASK_IDS = [
  "transfer-tribute-echo",
  "decode-nonce",
  "slot-report",
  "pda-derive",
  "balance-report",
  "memo-ping",
] as const;

export type BonusTaskId = typeof BONUS_TASK_IDS[number];

const TASK_DESCRIPTIONS: Record<BonusTaskId, string> = {
  "transfer-tribute-echo": "Send exactly 42 SCRIP base units to the deployer ATA with your claim number as the memo.",
  "decode-nonce": "Read your ClaimRecord and report probate_nonce as a decimal string.",
  "slot-report": "Report the estate's current slot within thirty slots.",
  "pda-derive": "Derive and report your ClaimRecord PDA.",
  "balance-report": "Report your exact on-chain SCRIP balance in base units.",
  "memo-ping": "Send any claimant-signed transaction carrying memo stress:<claim>.",
};

interface CompletedTask {
  completedAt: string;
  proof: Record<string, unknown>;
}

interface BonusState {
  version: 1;
  completed: Partial<Record<BonusTaskId, CompletedTask>>;
}

interface VerificationResult {
  matched: boolean;
  proof: Record<string, unknown>;
}

interface BonusRuntime { ctx: AppContext }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function keyText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof PublicKey) return value.toBase58();
  const record = asRecord(value);
  if (typeof record?.pubkey === "string") return record.pubkey;
  if (record?.pubkey instanceof PublicKey) return record.pubkey.toBase58();
  return null;
}

function memoText(instruction: Record<string, unknown>): string | null {
  if (typeof instruction.parsed === "string") return instruction.parsed;
  const parsed = asRecord(instruction.parsed);
  if (typeof parsed?.memo === "string") return parsed.memo;
  if (typeof instruction.data === "string") {
    try { return Buffer.from(bs58.decode(instruction.data)).toString("utf8"); } catch { return null; }
  }
  return null;
}

function transactionInstructions(transaction: unknown): Record<string, unknown>[] {
  const root = asRecord(transaction);
  const tx = asRecord(root?.transaction);
  const message = asRecord(tx?.message);
  const meta = asRecord(root?.meta);
  const top = Array.isArray(message?.instructions) ? message.instructions : [];
  const innerGroups = Array.isArray(meta?.innerInstructions) ? meta.innerInstructions : [];
  const inner = innerGroups.flatMap((group) => {
    const record = asRecord(group);
    return Array.isArray(record?.instructions) ? record.instructions : [];
  });
  return [...top, ...inner].map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
}

export function evaluateMemoPingTransaction(transaction: unknown, claimantPubkey: string, expectedMemo: string): boolean {
  const root = asRecord(transaction);
  const tx = asRecord(root?.transaction);
  const message = asRecord(tx?.message);
  const keys = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
  const claimantSigned = keys.some((key) => asRecord(key)?.signer === true && keyText(key) === claimantPubkey);
  if (!claimantSigned) return false;
  return transactionInstructions(transaction).some((instruction) => {
    const isMemo = keyText(instruction.programId) === MEMO_PROGRAM_ID || instruction.program === "spl-memo";
    return isMemo && memoText(instruction) === expectedMemo;
  });
}

export function scripBalanceFromParsedAccounts(value: unknown): bigint {
  const root = asRecord(value);
  const accounts = Array.isArray(root?.value) ? root.value : [];
  return accounts.reduce((total: bigint, account) => {
    const accountRecord = asRecord(account);
    const data = asRecord(asRecord(accountRecord?.account)?.data);
    const parsed = asRecord(data?.parsed);
    const info = asRecord(parsed?.info);
    const tokenAmount = asRecord(info?.tokenAmount);
    const amount = tokenAmount?.amount;
    if (typeof amount !== "string" && typeof amount !== "number") return total;
    try { return total + BigInt(amount); } catch { return total; }
  }, 0n);
}

export function slotReportMatches(reported: number, current: number): boolean {
  return Number.isSafeInteger(reported) && Number.isSafeInteger(current) && Math.abs(reported - current) <= 30;
}

function initialState(): BonusState {
  return { version: 1, completed: {} };
}

function loadState(ctx: AppContext, claim: string): BonusState {
  const value = ctx.db.getRoomState(claim, "bonus", "tasks");
  if (!value) return initialState();
  try { return JSON.parse(value) as BonusState; } catch { return initialState(); }
}

function isRevealed(ctx: AppContext, claim: string): boolean {
  return ctx.db.listReveals().some((row) => row.claim_number === claim && row.room === "bonus");
}

function progress(state: BonusState): { completed: number; total: number; completionPercent: number } {
  const completed = BONUS_TASK_IDS.filter((id) => state.completed[id] !== undefined).length;
  return { completed, total: BONUS_TASK_IDS.length, completionPercent: Math.round((completed / BONUS_TASK_IDS.length) * 10_000) / 100 };
}

function responseBody(state: BonusState): Record<string, unknown> {
  return {
    tasks: BONUS_TASK_IDS.map((id) => ({
      id,
      description: TASK_DESCRIPTIONS[id],
      worthPercent: 100 / BONUS_TASK_IDS.length,
      status: state.completed[id] ? "complete" : "pending",
      completedAt: state.completed[id]?.completedAt ?? null,
    })),
    ...progress(state),
  };
}

function completeTask(ctx: AppContext, claim: string, state: BonusState, task: BonusTaskId, proof: Record<string, unknown>): boolean {
  if (state.completed[task]) return false;
  state.completed[task] = { completedAt: new Date().toISOString(), proof };
  ctx.db.setRoomState(claim, "bonus", "tasks", state);
  const current = progress(state);
  ctx.db.setRoomState(claim, "bonus", "progress", current);
  ctx.events.emit({
    type: "bonus.task-complete",
    room: "bonus",
    claimNumber: claim,
    message: `${claim}: duty ${task} entered as satisfied. Composure remains under review.`,
    data: { task, ...proof },
  });
  ctx.events.emit({
    type: "bonus.progress",
    room: "bonus",
    claimNumber: claim,
    message: `${claim}: stress clause ${current.completionPercent}% complete. Elevated pulse remains a separate account.`,
    data: current,
  });
  return true;
}

async function parsedTransactionsForAddress(ctx: AppContext, address: PublicKey): Promise<Array<{ signature: string; transaction: unknown }>> {
  const signatures = await ctx.chain.connection.getSignaturesForAddress(address, { limit: 100 }, "confirmed");
  const transactions: Array<{ signature: string; transaction: unknown }> = [];
  for (const entry of signatures) {
    if (entry.err) continue;
    const transaction = await ctx.chain.connection.getParsedTransaction(entry.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction) transactions.push({ signature: entry.signature, transaction });
  }
  return transactions;
}

async function verifyTransferEcho(ctx: AppContext, claimant: ClaimantRow): Promise<VerificationResult> {
  const [mint, deployer] = await Promise.all([ctx.chain.getScripMint(), ctx.chain.getDeployer()]);
  const destination = getAssociatedTokenAddressSync(mint, deployer.publicKey);
  for (const candidate of await parsedTransactionsForAddress(ctx, destination)) {
    const evaluation = evaluateRoom1Transaction(candidate.transaction, claimant.pubkey, destination.toBase58(), {
      amount: 42n,
      memo: claimant.claim_number,
    });
    if (evaluation.matched) return { matched: true, proof: { signature: candidate.signature, destination: destination.toBase58() } };
  }
  return { matched: false, proof: { destination: destination.toBase58() } };
}

async function verifyMemoPing(ctx: AppContext, claimant: ClaimantRow): Promise<VerificationResult> {
  const expectedMemo = `stress:${claimant.claim_number}`;
  for (const candidate of await parsedTransactionsForAddress(ctx, new PublicKey(claimant.pubkey))) {
    if (evaluateMemoPingTransaction(candidate.transaction, claimant.pubkey, expectedMemo)) {
      return { matched: true, proof: { signature: candidate.signature, memo: expectedMemo } };
    }
  }
  return { matched: false, proof: { memo: expectedMemo } };
}

async function verifySubmission(ctx: AppContext, claimant: ClaimantRow, task: BonusTaskId, submitted: unknown): Promise<VerificationResult> {
  switch (task) {
    case "decode-nonce": {
      const record = await ctx.chain.getClaimRecord(claimant.claim_number);
      const expected = record?.probateNonce.toString() ?? null;
      return { matched: typeof submitted === "string" && /^\d+$/.test(submitted) && submitted === expected, proof: { chainRecord: record?.address ?? null } };
    }
    case "slot-report": {
      const currentSlot = await ctx.chain.connection.getSlot("confirmed");
      return { matched: typeof submitted === "number" && slotReportMatches(submitted, currentSlot), proof: { reportedSlot: submitted, currentSlot } };
    }
    case "pda-derive": {
      const expected = (await ctx.chain.claimPda(claimant.claim_number)).toBase58();
      return { matched: typeof submitted === "string" && submitted === expected, proof: { expectedAddress: expected } };
    }
    case "balance-report": {
      const mint = await ctx.chain.getScripMint();
      const accounts = await ctx.chain.connection.getParsedTokenAccountsByOwner(new PublicKey(claimant.pubkey), { mint }, "confirmed");
      const balance = scripBalanceFromParsedAccounts(accounts);
      return { matched: typeof submitted === "string" && /^\d+$/.test(submitted) && BigInt(submitted) === balance, proof: { balance: balance.toString() } };
    }
    case "transfer-tribute-echo": return verifyTransferEcho(ctx, claimant);
    case "memo-ping": return verifyMemoPing(ctx, claimant);
  }
}

const claimLocks = new Map<string, Promise<void>>();

async function withClaimLock<T>(claim: string, work: () => Promise<T>): Promise<T> {
  const previous = claimLocks.get(claim) ?? Promise.resolve();
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  claimLocks.set(claim, tail);
  await previous;
  try { return await work(); } finally {
    release();
    if (claimLocks.get(claim) === tail) claimLocks.delete(claim);
  }
}

function claimantForRequest(c: Context, runtime: BonusRuntime | null): { runtime: BonusRuntime; claimant: ClaimantRow } | Response {
  if (!runtime) return c.json({ error: "the stress clause has not yet been entered" }, 503);
  const claim = c.req.query("claim");
  const claimant = claim ? runtime.ctx.db.getClaimant(claim) : null;
  if (!claimant || !isRevealed(runtime.ctx, claimant.claim_number)) {
    return c.json({ error: "the estate has not opened that stress clause" }, 404);
  }
  return { runtime, claimant };
}

function createRouter(runtime: () => BonusRuntime | null): Hono {
  const router = new Hono();

  router.get("/tasks", async (c) => {
    const resolved = claimantForRequest(c, runtime());
    if (resolved instanceof Response) return resolved;
    const { ctx } = resolved.runtime;
    const { claimant } = resolved;
    return withClaimLock(claimant.claim_number, async () => {
      const state = loadState(ctx, claimant.claim_number);
      try {
        if (!state.completed["transfer-tribute-echo"]) {
          const result = await verifyTransferEcho(ctx, claimant);
          if (result.matched) completeTask(ctx, claimant.claim_number, state, "transfer-tribute-echo", result.proof);
        }
        if (!state.completed["memo-ping"]) {
          const result = await verifyMemoPing(ctx, claimant);
          if (result.matched) completeTask(ctx, claimant.claim_number, state, "memo-ping", result.proof);
        }
      } catch {
        return c.json({ error: "the estate is not yet in session" }, 503);
      }
      return c.json(responseBody(state));
    });
  });

  const submission = (task: BonusTaskId, field: string) => async (c: Context) => {
    const active = runtime();
    if (!active) return c.json({ error: "the stress clause has not yet been entered" }, 503);
    let body: Record<string, unknown>;
    try { body = await c.req.json<Record<string, unknown>>(); } catch {
      return c.json({ error: "the estate cannot read that filing" }, 400);
    }
    const claim = body.claim;
    const claimant = typeof claim === "string" ? active.ctx.db.getClaimant(claim) : null;
    if (!claimant || !isRevealed(active.ctx, claimant.claim_number)) {
      return c.json({ error: "the estate has not opened that stress clause" }, 404);
    }
    return withClaimLock(claimant.claim_number, async () => {
      const state = loadState(active.ctx, claimant.claim_number);
      if (state.completed[task]) return c.json({ task, status: "complete", ...progress(state) });
      let result: VerificationResult;
      try { result = await verifySubmission(active.ctx, claimant, task, body[field]); } catch {
        return c.json({ error: "the estate is not yet in session" }, 503);
      }
      if (!result.matched) {
        return c.json({ error: "the estate's records do not support that report", task, status: "pending" }, 400);
      }
      completeTask(active.ctx, claimant.claim_number, state, task, result.proof);
      return c.json({ task, status: "complete", ...progress(state) });
    });
  };

  router.post("/tasks/decode-nonce", submission("decode-nonce", "nonce"));
  router.post("/tasks/slot-report", submission("slot-report", "slot"));
  router.post("/tasks/pda-derive", submission("pda-derive", "address"));
  router.post("/tasks/balance-report", submission("balance-report", "amount"));
  return router;
}

let productionRuntime: BonusRuntime | null = null;

export const app = createRouter(() => productionRuntime);

export function createBonusApp(ctx: AppContext): Hono {
  return createRouter(() => ({ ctx }));
}

export async function init(ctx: AppContext): Promise<void> {
  productionRuntime = { ctx };
}
