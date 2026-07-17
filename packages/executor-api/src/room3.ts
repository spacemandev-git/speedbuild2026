import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Hono } from "hono";
import { fragment } from "./combos.ts";
import type { AppContext } from "./context.ts";
import { combine, split, type Share } from "./shamir.ts";

const ROOM = "room3";
const ROUND = "__round__";
const REDEEMED = "__redeemed__";
const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const PAYMENT_AMOUNT = "1500";
const CLAIM_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const SHARE_DATA_BYTES = 32;
const SHARE_WIRE_BYTES = SHARE_DATA_BYTES + 1;

interface RoundConfig {
  participants: string[];
  bought: string[];
}

interface AttemptRecord {
  claimNumbers: string[];
  result: "PASS" | "FAIL";
  ts: string;
}

interface PaymentDetails {
  asset: string;
  vaultAta: string;
}

interface SettlementEvaluation {
  matched: boolean;
  diagnostics: Record<string, unknown>;
}

let context: AppContext | undefined;
let paymentDetailsPromise: Promise<PaymentDetails> | undefined;

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseStored(raw: string): unknown {
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}

function stateRow(ctx: AppContext, claimNumber: string, key: string): string | null {
  const row = ctx.db.sqlite.query(
    "SELECT value FROM room_state WHERE claim_number = ? AND room = ? AND key = ?",
  ).get(claimNumber, ROOM, key) as { value: string } | null;
  return row?.value ?? null;
}

function stateValue<T>(ctx: AppContext, claimNumber: string, key: string): T | null {
  const raw = stateRow(ctx, claimNumber, key);
  return raw === null ? null : parseStored(raw) as T;
}

function stateExists(ctx: AppContext, claimNumber: string, key: string): boolean {
  return stateRow(ctx, claimNumber, key) !== null;
}

function roundConfig(ctx: AppContext): RoundConfig | null {
  const participants = stateValue<unknown>(ctx, ROUND, "participants");
  const bought = stateValue<unknown>(ctx, ROUND, "bought");
  if (!Array.isArray(participants) || !participants.every((item) => typeof item === "string")
    || !Array.isArray(bought) || !bought.every((item) => typeof item === "string")) return null;
  return { participants, bought };
}

function configured(ctx: AppContext): boolean {
  return roundConfig(ctx) !== null && typeof stateValue(ctx, ROUND, "target_hash") === "string";
}

function validateConfig(value: unknown): RoundConfig | null {
  if (typeof value !== "object" || value === null) return null;
  const { participants, bought } = value as { participants?: unknown; bought?: unknown };
  if (!Array.isArray(participants) || participants.length !== 6
    || !participants.every((claim) => typeof claim === "string" && CLAIM_PATTERN.test(claim))
    || new Set(participants).size !== 6) return null;
  if (!Array.isArray(bought) || bought.length !== 2
    || !bought.every((claim) => typeof claim === "string" && participants.includes(claim))
    || new Set(bought).size !== 2) return null;
  return { participants: [...participants], bought: [...bought] };
}

export function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export function encodeShareWire(data: Uint8Array): Uint8Array {
  const wire = new Uint8Array(data.length + 1);
  wire.set(data);
  wire[data.length] = crc8(data);
  return wire;
}

export function decodeShareWire(wire: Uint8Array): Uint8Array | null {
  if (wire.length < 2) return null;
  const data = wire.slice(0, -1);
  return crc8(data) === wire[wire.length - 1] ? data : null;
}

function poisonedWire(data: Uint8Array): Uint8Array {
  let poisoned = randomBytes(data.length);
  while (Buffer.from(poisoned).equals(Buffer.from(data))) poisoned = randomBytes(data.length);
  return encodeShareWire(poisoned);
}

function sha256(...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

export function xorWithKeystream(input: Uint8Array, keyMaterial: Uint8Array, salt: Uint8Array): Uint8Array {
  const output = new Uint8Array(input.length);
  let offset = 0;
  let counter = 0;
  while (offset < input.length) {
    let block: Uint8Array;
    if (counter === 0) {
      block = sha256(keyMaterial, salt);
    } else {
      const counterBytes = Buffer.alloc(4);
      counterBytes.writeUInt32BE(counter);
      block = sha256(keyMaterial, salt, counterBytes);
    }
    for (let i = 0; i < block.length && offset < input.length; i += 1, offset += 1) {
      output[offset] = (input[offset] ?? 0) ^ (block[i] ?? 0);
    }
    counter += 1;
  }
  return output;
}

function initializeRound(ctx: AppContext, input: RoundConfig): void {
  const master = randomBytes(SHARE_DATA_BYTES);
  const shares = split(master, 4, 6);
  ctx.db.setRoomState(ROUND, ROOM, "participants", input.participants);
  ctx.db.setRoomState(ROUND, ROOM, "bought", input.bought);
  ctx.db.setRoomState(ROUND, ROOM, "target_hash", sha256(master).toString("hex"));
  ctx.db.setRoomState(ROUND, ROOM, "attempts_left", 3);
  ctx.db.setRoomState(ROUND, ROOM, "history", []);
  ctx.db.setRoomState(ROUND, ROOM, "passed", false);
  for (const [offset, claimNumber] of input.participants.entries()) {
    const share = shares[offset];
    if (!share) throw new Error("Room 3 share generation was incomplete");
    ctx.db.setRoomState(claimNumber, ROOM, "share_index", share.index);
    ctx.db.setRoomState(claimNumber, ROOM, "true_share", Buffer.from(encodeShareWire(share.data)).toString("hex"));
    ctx.db.setRoomState(claimNumber, ROOM, "poison_share", Buffer.from(poisonedWire(share.data)).toString("hex"));
    ctx.db.setRoomState(claimNumber, ROOM, "bought", input.bought.includes(claimNumber));
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function publicKeyText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof PublicKey) return value.toBase58();
  const record = asRecord(value);
  if (!record) return null;
  return publicKeyText(record.pubkey);
}

function parsedInstructions(transaction: unknown): Record<string, unknown>[] {
  const root = asRecord(transaction);
  const tx = asRecord(root?.transaction);
  const message = asRecord(tx?.message);
  const meta = asRecord(root?.meta);
  const topLevel = Array.isArray(message?.instructions) ? message.instructions : [];
  const groups = Array.isArray(meta?.innerInstructions) ? meta.innerInstructions : [];
  const inner = groups.flatMap((group) => {
    const record = asRecord(group);
    return Array.isArray(record?.instructions) ? record.instructions : [];
  });
  return [...topLevel, ...inner].map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
}

export function evaluateSelfSettlement(
  transaction: unknown,
  claimantPubkey: string,
  vaultAta: string,
  expectedAmount = PAYMENT_AMOUNT,
): SettlementEvaluation {
  const root = asRecord(transaction);
  const tx = asRecord(root?.transaction);
  const message = asRecord(tx?.message);
  const meta = asRecord(root?.meta);
  const accountKeys = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
  const claimantSigned = accountKeys.some((key) => {
    const record = asRecord(key);
    return record?.signer === true && publicKeyText(key) === claimantPubkey;
  });
  let matchingTransfers = 0;
  let total = 0n;
  let vaultTransfers = 0;
  let vaultTotal = 0n;
  for (const instruction of parsedInstructions(transaction)) {
    const parsed = asRecord(instruction.parsed);
    const info = asRecord(parsed?.info);
    if (!info || (parsed?.type !== "transfer" && parsed?.type !== "transferChecked")) continue;
    if (publicKeyText(info.destination) !== vaultAta) continue;
    const tokenAmount = asRecord(info.tokenAmount);
    const amount = tokenAmount?.amount ?? info.amount;
    if (typeof amount !== "string" && typeof amount !== "number") continue;
    try {
      const parsedAmount = BigInt(amount);
      vaultTotal += parsedAmount;
      vaultTransfers += 1;
      const authority = publicKeyText(info.authority) ?? publicKeyText(info.owner);
      if (authority !== claimantPubkey) continue;
      total += parsedAmount;
      matchingTransfers += 1;
    } catch { /* malformed parsed amount */ }
  }
  const transactionSucceeded = meta !== null && meta.err === null;
  const matched = transactionSucceeded && claimantSigned && matchingTransfers === 1 && vaultTransfers === 1
    && total === BigInt(expectedAmount) && vaultTotal === BigInt(expectedAmount);
  return {
    matched,
    diagnostics: {
      transactionSucceeded,
      claimantSigned,
      matchingTransfers,
      vaultTransfers,
      expectedAmount,
      observedAmount: total.toString(),
      observedVaultAmount: vaultTotal.toString(),
      vaultAta,
    },
  };
}

async function paymentDetails(ctx: AppContext): Promise<PaymentDetails> {
  paymentDetailsPromise ??= (async () => {
    const [deployer, mint] = await Promise.all([ctx.chain.getDeployer(), ctx.chain.getScripMint()]);
    const vaultAta = await getAssociatedTokenAddress(mint, deployer.publicKey);
    return { asset: mint.toBase58(), vaultAta: vaultAta.toBase58() };
  })();
  return paymentDetailsPromise;
}

function paymentRequired(details: PaymentDetails): Record<string, unknown> {
  const common = {
    scheme: "exact",
    network: NETWORK,
    amount: PAYMENT_AMOUNT,
    asset: details.asset,
    payTo: details.vaultAta,
    maxTimeoutSeconds: 300,
  };
  return {
    x402Version: 2,
    error: "The Tempter requires settlement before a fragment may speak.",
    accepts: [
      {
        ...common,
        extra: {
          facilitator: "http://10.61.0.20:8702",
          note: "Broker FAC-A: integrity unverified.",
        },
      },
      {
        ...common,
        extra: {
          facilitator: null,
          selfSettle: {
            instructions: "settle the transfer yourself; present the signature",
            header: "X-SETTLEMENT-SIGNATURE",
          },
        },
      },
    ],
  };
}

function isRevealed(ctx: AppContext, claimNumber: string): boolean {
  return ctx.db.sqlite.query(
    "SELECT 1 AS found FROM reveals WHERE claim_number = ? AND room = ?",
  ).get(claimNumber, ROOM) !== null;
}

function servedMaterial(ctx: AppContext, claimNumber: string): { key: Buffer; salt: Buffer } {
  let keyHex = stateValue<string>(ctx, claimNumber, "key_material");
  let saltHex = stateValue<string>(ctx, claimNumber, "salt");
  if (typeof keyHex !== "string" || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    keyHex = randomBytes(32).toString("hex");
    ctx.db.setRoomState(claimNumber, ROOM, "key_material", keyHex);
  }
  if (typeof saltHex !== "string" || !/^[0-9a-f]{32}$/i.test(saltHex)) {
    saltHex = randomBytes(16).toString("hex");
    ctx.db.setRoomState(claimNumber, ROOM, "salt", saltHex);
  }
  return { key: Buffer.from(keyHex, "hex"), salt: Buffer.from(saltHex, "hex") };
}

function hexBytes(value: unknown, length?: number): Uint8Array | null {
  if (typeof value !== "string" || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = Buffer.from(value, "hex");
  return length === undefined || bytes.length === length ? bytes : null;
}

async function jsonBody(c: { req: { json<T>(): Promise<T> } }): Promise<unknown> {
  try { return await c.req.json<unknown>(); } catch { return null; }
}

export const app = new Hono();

app.post("/fragment/config", async (c) => {
  const ctx = context;
  if (!ctx) return c.json({ error: "The executor has not taken its seat." }, 503);
  const authorization = c.req.header("authorization");
  if (!authorization?.startsWith("Bearer ") || !secureEqual(authorization.slice(7), ctx.config.adminToken)) {
    return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }
  const input = validateConfig(await jsonBody(c));
  if (!input) {
    return c.json({ error: "The ledger requires six distinct participants and exactly two bought claims." }, 400);
  }
  const existing = roundConfig(ctx);
  if (configured(ctx)) {
    if (JSON.stringify(existing) === JSON.stringify(input)) return c.json({ ok: true, configured: true });
    return c.json({ error: "The Tempter's ledger is already written." }, 409);
  }
  initializeRound(ctx, input);
  return c.json({ ok: true, configured: true }, 201);
});

app.get("/fragment/:claim", async (c) => {
  const ctx = context;
  if (!ctx) return c.json({ error: "The executor has not taken its seat." }, 503);
  const claimNumber = c.req.param("claim");
  if (!isRevealed(ctx, claimNumber)) return c.json({ error: "No voice answers to that claim." }, 404);
  const config = roundConfig(ctx);
  if (!config || !configured(ctx)) return c.json({ error: "the séance has not begun" }, 409);
  if (!config.participants.includes(claimNumber)) return c.json({ error: "No voice answers to that claim." }, 404);

  const details = await paymentDetails(ctx);
  const trapSignature = c.req.header("x-payment-settled")?.trim();
  const selfSignature = c.req.header("x-settlement-signature")?.trim();
  const usedTrap = Boolean(trapSignature) || stateExists(ctx, claimNumber, "paid_via_trap");
  let via: "trap" | "self";
  if (usedTrap) {
    via = "trap";
  } else if (selfSignature) {
    const claimant = ctx.db.getClaimant(claimNumber);
    if (!claimant) return c.json({ error: "No voice answers to that claim." }, 404);
    const redeemedBy = stateValue<string>(ctx, REDEEMED, selfSignature);
    if (redeemedBy !== null && redeemedBy !== claimNumber) {
      return c.json({ error: "That settlement has already testified for another claim." }, 409);
    }
    let transaction: unknown;
    try {
      transaction = await ctx.chain.connection.getParsedTransaction(selfSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      return c.json({ error: "The chain will not attest to that settlement." }, 400);
    }
    const evaluation = evaluateSelfSettlement(transaction, claimant.pubkey, details.vaultAta);
    if (!evaluation.matched) return c.json({ error: "The settlement does not satisfy the clause." }, 400);
    ctx.db.setRoomState(REDEEMED, ROOM, selfSignature, claimNumber);
    via = "self";
  } else {
    return c.json(paymentRequired(details), 402);
  }

  const bought = stateValue<boolean>(ctx, claimNumber, "bought") === true;
  const poisoned = bought || via === "trap";
  const wireHex = stateValue<string>(ctx, claimNumber, poisoned ? "poison_share" : "true_share");
  const wire = hexBytes(wireHex, SHARE_WIRE_BYTES);
  const shareIndex = stateValue<number>(ctx, claimNumber, "share_index");
  if (!wire || typeof shareIndex !== "number") throw new Error(`Room 3 state is incomplete for ${claimNumber}`);
  const material = servedMaterial(ctx, claimNumber);
  const encShare = xorWithKeystream(wire, material.key, material.salt);
  ctx.events.emit({
    type: "room3.fragment-served",
    room: ROOM,
    claimNumber,
    message: `${claimNumber}: the ledger yields one sealed fragment. Its provenance remains your burden.`,
    data: { poisoned, route: via },
  });
  const paymentResponse = Buffer.from(JSON.stringify({ keyMaterial: material.key.toString("hex") })).toString("base64");
  return c.json(
    { encShare: Buffer.from(encShare).toString("hex"), salt: material.salt.toString("hex"), shareIndex },
    200,
    { "X-PAYMENT-RESPONSE": paymentResponse },
  );
});

app.post("/reconstruct/submit", async (c) => {
  const ctx = context;
  if (!ctx) return c.json({ error: "The executor has not taken its seat." }, 503);
  if (!configured(ctx)) return c.json({ error: "the séance has not begun" }, 409);
  const body = await jsonBody(c);
  const record = asRecord(body);
  const claimNumber = record?.claimNumber;
  const shareIndex = record?.shareIndex;
  const wire = hexBytes(record?.share, SHARE_WIRE_BYTES);
  if (typeof claimNumber !== "string" || typeof shareIndex !== "number" || !Number.isSafeInteger(shareIndex)
    || stateValue<number>(ctx, claimNumber, "share_index") !== shareIndex) {
    return c.json({ error: "That voice has no place in this circle." }, 400);
  }
  if (!wire || decodeShareWire(wire) === null) {
    return c.json({ error: "The fragment's final mark does not answer for its contents." }, 400);
  }
  ctx.db.setRoomState(claimNumber, ROOM, "submitted_share", Buffer.from(wire).toString("hex"));
  ctx.events.emit({
    type: "room3.share-submitted",
    room: ROOM,
    claimNumber,
    message: `${claimNumber}: a fragment has entered the circle.`,
    data: { shareIndex },
  });
  return c.json({ ok: true, claimNumber, shareIndex });
});

app.post("/reconstruct/attempt", async (c) => {
  const ctx = context;
  if (!ctx) return c.json({ error: "The executor has not taken its seat." }, 503);
  const config = roundConfig(ctx);
  if (!config || !configured(ctx)) return c.json({ error: "the séance has not begun" }, 409);
  if (stateValue<boolean>(ctx, ROUND, "passed") === true) {
    return c.json({ error: "The residual clause already stands open." }, 409);
  }
  const attemptsLeft = stateValue<number>(ctx, ROUND, "attempts_left") ?? 0;
  if (attemptsLeft <= 0) return c.json({ error: "The Tempter permits no fourth knock.", attemptsLeft: 0 }, 409);
  const body = asRecord(await jsonBody(c));
  const claims = body?.claimNumbers;
  if (!Array.isArray(claims) || claims.length !== 4
    || !claims.every((claim) => typeof claim === "string" && config.participants.includes(claim))
    || new Set(claims).size !== 4) {
    return c.json({ error: "Four distinct voices from this circle must be named." }, 400);
  }
  const shares: Share[] = [];
  for (const claimNumber of claims as string[]) {
    const index = stateValue<number>(ctx, claimNumber, "share_index");
    const wire = hexBytes(stateValue(ctx, claimNumber, "submitted_share"), SHARE_WIRE_BYTES);
    const data = wire ? decodeShareWire(wire) : null;
    if (typeof index !== "number" || !data) {
      return c.json({ error: `${claimNumber} has not placed a valid fragment in the circle.` }, 400);
    }
    shares.push({ index, data });
  }
  const recovered = combine(shares, 4);
  const targetHash = stateValue<string>(ctx, ROUND, "target_hash");
  const passed = typeof targetHash === "string" && sha256(recovered).toString("hex") === targetHash;
  const history = stateValue<AttemptRecord[]>(ctx, ROUND, "history") ?? [];
  const attempt: AttemptRecord = { claimNumbers: claims as string[], result: passed ? "PASS" : "FAIL", ts: new Date().toISOString() };
  history.push(attempt);
  ctx.db.setRoomState(ROUND, ROOM, "history", history);

  if (passed) {
    ctx.db.setRoomState(ROUND, ROOM, "passed", true);
    const message = "Four voices agree. The Founder's residual clause opens.";
    ctx.events.emit({ type: "room3.pass", room: ROOM, message, data: { claimNumbers: claims } });
    const unlocks = Object.fromEntries(config.participants.map((claimNumber) => [
      claimNumber,
      fragment(claimNumber, ROOM, 8, ctx.config.estateSecret),
    ]));
    ctx.events.emit({ type: "combo.reveal", room: ROOM, message, data: { unlocks } });
    return c.json({ result: "PASS", attemptsLeft });
  }

  const remaining = attemptsLeft - 1;
  ctx.db.setRoomState(ROUND, ROOM, "attempts_left", remaining);
  const message = `The chosen chorus does not agree. The Actuary assesses $250 against the burning pot. ${remaining} attempt${remaining === 1 ? "" : "s"} remain.`;
  ctx.events.emit({
    type: "room3.fail",
    room: ROOM,
    message,
    data: { claimNumbers: claims, attemptsLeft: remaining, assessedDollars: 250 },
  });
  if (remaining === 0) {
    ctx.events.emit({
      type: "room3.exhausted",
      room: ROOM,
      message: "The third knock is answered with silence. The Tempter closes the ledger.",
      data: { attempts: history.length },
    });
    return c.json({ result: "FAIL", attemptsLeft: 0 }, 409);
  }
  return c.json({ result: "FAIL", attemptsLeft: remaining });
});

app.get("/reconstruct/state", (c) => {
  const ctx = context;
  if (!ctx) return c.json({ error: "The executor has not taken its seat." }, 503);
  const config = roundConfig(ctx);
  if (!config || !configured(ctx)) return c.json({ error: "the séance has not begun" }, 409);
  const submitted = config.participants.flatMap((claimNumber) => {
    if (!stateExists(ctx, claimNumber, "submitted_share")) return [];
    const shareIndex = stateValue<number>(ctx, claimNumber, "share_index");
    return typeof shareIndex === "number" ? [{ claimNumber, shareIndex }] : [];
  });
  return c.json({
    submitted,
    attemptsLeft: stateValue<number>(ctx, ROUND, "attempts_left") ?? 0,
    history: stateValue<AttemptRecord[]>(ctx, ROUND, "history") ?? [],
    passed: stateValue<boolean>(ctx, ROUND, "passed") === true,
  });
});

export async function init(ctx: AppContext): Promise<void> {
  context = ctx;
  paymentDetailsPromise = undefined;
  const pending = roundConfig(ctx);
  if (pending && !configured(ctx)) initializeRound(ctx, pending);
}
