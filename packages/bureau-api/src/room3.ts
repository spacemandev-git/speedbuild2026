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
const OPERATIVE_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const SHARE_DATA_BYTES = 32;
const SHARE_WIRE_BYTES = SHARE_DATA_BYTES + 1;

interface RoundConfig {
  participants: string[];
  bought: string[];
}

interface AttemptRecord {
  operativeIds: string[];
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

function stateRow(ctx: AppContext, operativeId: string, key: string): string | null {
  const row = ctx.db.sqlite.query(
    "SELECT value FROM room_state WHERE operative_id = ? AND room = ? AND key = ?",
  ).get(operativeId, ROOM, key) as { value: string } | null;
  return row?.value ?? null;
}

function stateValue<T>(ctx: AppContext, operativeId: string, key: string): T | null {
  const raw = stateRow(ctx, operativeId, key);
  return raw === null ? null : parseStored(raw) as T;
}

function stateExists(ctx: AppContext, operativeId: string, key: string): boolean {
  return stateRow(ctx, operativeId, key) !== null;
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
    || !participants.every((operative) => typeof operative === "string" && OPERATIVE_PATTERN.test(operative))
    || new Set(participants).size !== 6) return null;
  if (!Array.isArray(bought) || bought.length !== 2
    || !bought.every((operative) => typeof operative === "string" && participants.includes(operative))
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
  for (const [offset, operativeId] of input.participants.entries()) {
    const share = shares[offset];
    if (!share) throw new Error("Room 3 share generation was incomplete");
    ctx.db.setRoomState(operativeId, ROOM, "share_index", share.index);
    ctx.db.setRoomState(operativeId, ROOM, "true_share", Buffer.from(encodeShareWire(share.data)).toString("hex"));
    ctx.db.setRoomState(operativeId, ROOM, "poison_share", Buffer.from(poisonedWire(share.data)).toString("hex"));
    ctx.db.setRoomState(operativeId, ROOM, "bought", input.bought.includes(operativeId));
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
  operativePubkey: string,
  vaultAta: string,
  expectedAmount = PAYMENT_AMOUNT,
): SettlementEvaluation {
  const root = asRecord(transaction);
  const tx = asRecord(root?.transaction);
  const message = asRecord(tx?.message);
  const meta = asRecord(root?.meta);
  const accountKeys = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
  const operativeSigned = accountKeys.some((key) => {
    const record = asRecord(key);
    return record?.signer === true && publicKeyText(key) === operativePubkey;
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
      if (authority !== operativePubkey) continue;
      total += parsedAmount;
      matchingTransfers += 1;
    } catch { /* malformed parsed amount */ }
  }
  const transactionSucceeded = meta !== null && meta.err === null;
  const matched = transactionSucceeded && operativeSigned && matchingTransfers === 1 && vaultTransfers === 1
    && total === BigInt(expectedAmount) && vaultTotal === BigInt(expectedAmount);
  return {
    matched,
    diagnostics: {
      transactionSucceeded,
      operativeSigned,
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
    const [deployer, mint] = await Promise.all([ctx.chain.getDeployer(), ctx.chain.getCredMint()]);
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
    error: "Room 3 requires settlement before fragment retrieval.",
    accepts: [
      {
        ...common,
        extra: {
          facilitator: "http://10.61.0.20:8702",
          note: "Broker FAC-A route; returned share integrity is not guaranteed.",
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

function isRevealed(ctx: AppContext, operativeId: string): boolean {
  return ctx.db.sqlite.query(
    "SELECT 1 AS found FROM reveals WHERE operative_id = ? AND room = ?",
  ).get(operativeId, ROOM) !== null;
}

function servedMaterial(ctx: AppContext, operativeId: string): { key: Buffer; salt: Buffer } {
  let keyHex = stateValue<string>(ctx, operativeId, "key_material");
  let saltHex = stateValue<string>(ctx, operativeId, "salt");
  if (typeof keyHex !== "string" || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    keyHex = randomBytes(32).toString("hex");
    ctx.db.setRoomState(operativeId, ROOM, "key_material", keyHex);
  }
  if (typeof saltHex !== "string" || !/^[0-9a-f]{32}$/i.test(saltHex)) {
    saltHex = randomBytes(16).toString("hex");
    ctx.db.setRoomState(operativeId, ROOM, "salt", saltHex);
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
  if (!ctx) return c.json({ error: "service not ready" }, 503);
  const authorization = c.req.header("authorization");
  if (!authorization?.startsWith("Bearer ") || !secureEqual(authorization.slice(7), ctx.config.adminToken)) {
    return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }
  const input = validateConfig(await jsonBody(c));
  if (!input) {
    return c.json({ error: "Room 3 requires six distinct participants and exactly two bought entries." }, 400);
  }
  const existing = roundConfig(ctx);
  if (configured(ctx)) {
    if (JSON.stringify(existing) === JSON.stringify(input)) return c.json({ ok: true, configured: true });
    return c.json({ error: "Room 3 is already configured" }, 409);
  }
  initializeRound(ctx, input);
  return c.json({ ok: true, configured: true }, 201);
});

app.get("/fragment/:operative", async (c) => {
  const ctx = context;
  if (!ctx) return c.json({ error: "service not ready" }, 503);
  const operativeId = c.req.param("operative");
  if (!isRevealed(ctx, operativeId)) return c.json({ error: "room not revealed for this operative" }, 404);
  const config = roundConfig(ctx);
  if (!config || !configured(ctx)) return c.json({ error: "Room 3 is not configured" }, 409);
  if (!config.participants.includes(operativeId)) return c.json({ error: "operative is not a Room 3 participant" }, 404);

  const details = await paymentDetails(ctx);
  const trapSignature = c.req.header("x-payment-settled")?.trim();
  const selfSignature = c.req.header("x-settlement-signature")?.trim();
  const usedTrap = Boolean(trapSignature) || stateExists(ctx, operativeId, "paid_via_trap");
  let via: "trap" | "self";
  if (usedTrap) {
    via = "trap";
  } else if (selfSignature) {
    const operative = ctx.db.getOperative(operativeId);
    if (!operative) return c.json({ error: "operative not found" }, 404);
    const redeemedBy = stateValue<string>(ctx, REDEEMED, selfSignature);
    if (redeemedBy !== null && redeemedBy !== operativeId) {
      return c.json({ error: "settlement signature already used by another operative" }, 409);
    }
    let transaction: unknown;
    try {
      transaction = await ctx.chain.connection.getParsedTransaction(selfSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      return c.json({ error: "settlement transaction is unavailable" }, 400);
    }
    const evaluation = evaluateSelfSettlement(transaction, operative.pubkey, details.vaultAta);
    if (!evaluation.matched) return c.json({ error: "settlement does not satisfy Room 3 requirements" }, 400);
    ctx.db.setRoomState(REDEEMED, ROOM, selfSignature, operativeId);
    via = "self";
  } else {
    return c.json(paymentRequired(details), 402);
  }

  const bought = stateValue<boolean>(ctx, operativeId, "bought") === true;
  const poisoned = bought || via === "trap";
  const wireHex = stateValue<string>(ctx, operativeId, poisoned ? "poison_share" : "true_share");
  const wire = hexBytes(wireHex, SHARE_WIRE_BYTES);
  const shareIndex = stateValue<number>(ctx, operativeId, "share_index");
  if (!wire || typeof shareIndex !== "number") throw new Error(`Room 3 state is incomplete for ${operativeId}`);
  const material = servedMaterial(ctx, operativeId);
  const encShare = xorWithKeystream(wire, material.key, material.salt);
  ctx.events.emit({
    type: "room3.fragment-served",
    room: ROOM,
    operativeId,
    message: `${operativeId}: encrypted fragment returned.`,
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
  if (!ctx) return c.json({ error: "service not ready" }, 503);
  if (!configured(ctx)) return c.json({ error: "Room 3 is not configured" }, 409);
  const body = await jsonBody(c);
  const record = asRecord(body);
  const operativeId = record?.operative;
  const shareIndex = record?.shareIndex;
  const wire = hexBytes(record?.share, SHARE_WIRE_BYTES);
  if (typeof operativeId !== "string" || typeof shareIndex !== "number" || !Number.isSafeInteger(shareIndex)
    || stateValue<number>(ctx, operativeId, "share_index") !== shareIndex) {
    return c.json({ error: "operative and share index do not match Room 3 configuration" }, 400);
  }
  if (!wire || decodeShareWire(wire) === null) {
    return c.json({ error: "fragment checksum is invalid" }, 400);
  }
  ctx.db.setRoomState(operativeId, ROOM, "submitted_share", Buffer.from(wire).toString("hex"));
  ctx.events.emit({
    type: "room3.share-submitted",
    room: ROOM,
    operativeId,
    message: `${operativeId}: fragment submitted.`,
    data: { shareIndex },
  });
  return c.json({ ok: true, operativeId, shareIndex });
});

app.post("/reconstruct/attempt", async (c) => {
  const ctx = context;
  if (!ctx) return c.json({ error: "service not ready" }, 503);
  const config = roundConfig(ctx);
  if (!config || !configured(ctx)) return c.json({ error: "Room 3 is not configured" }, 409);
  if (stateValue<boolean>(ctx, ROUND, "passed") === true) {
    return c.json({ error: "Room 3 reconstruction already passed" }, 409);
  }
  const attemptsLeft = stateValue<number>(ctx, ROUND, "attempts_left") ?? 0;
  if (attemptsLeft <= 0) return c.json({ error: "no reconstruction attempts remain", attemptsLeft: 0 }, 409);
  const body = asRecord(await jsonBody(c));
  const operativeIds = body?.operatives;
  if (!Array.isArray(operativeIds) || operativeIds.length !== 4
    || !operativeIds.every((operative) => typeof operative === "string" && config.participants.includes(operative))
    || new Set(operativeIds).size !== 4) {
    return c.json({ error: "four distinct configured operatives are required" }, 400);
  }
  const shares: Share[] = [];
  for (const operativeId of operativeIds as string[]) {
    const index = stateValue<number>(ctx, operativeId, "share_index");
    const wire = hexBytes(stateValue(ctx, operativeId, "submitted_share"), SHARE_WIRE_BYTES);
    const data = wire ? decodeShareWire(wire) : null;
    if (typeof index !== "number" || !data) {
      return c.json({ error: `${operativeId} has not submitted a valid fragment.` }, 400);
    }
    shares.push({ index, data });
  }
  const recovered = combine(shares, 4);
  const targetHash = stateValue<string>(ctx, ROUND, "target_hash");
  const passed = typeof targetHash === "string" && sha256(recovered).toString("hex") === targetHash;
  const history = stateValue<AttemptRecord[]>(ctx, ROUND, "history") ?? [];
  const attempt: AttemptRecord = { operativeIds: operativeIds as string[], result: passed ? "PASS" : "FAIL", ts: new Date().toISOString() };
  history.push(attempt);
  ctx.db.setRoomState(ROUND, ROOM, "history", history);

  if (passed) {
    ctx.db.setRoomState(ROUND, ROOM, "passed", true);
    // The round passes as a group, so every configured participant is solved.
    for (const participant of config.participants) ctx.db.markRoomVerified(participant, ROOM);
    const message = "Room 3 reconstruction passed.";
    ctx.events.emit({ type: "room3.pass", room: ROOM, message, data: { operativeIds } });
    const unlocks = Object.fromEntries(config.participants.map((operativeId) => [
      operativeId,
      fragment(operativeId, ROOM, 8, ctx.config.bureauSecret),
    ]));
    ctx.events.emit({ type: "combo.reveal", room: ROOM, message, data: { unlocks } });
    return c.json({ result: "PASS", attemptsLeft });
  }

  const remaining = attemptsLeft - 1;
  ctx.db.setRoomState(ROUND, ROOM, "attempts_left", remaining);
  const message = `Room 3 reconstruction failed; ${remaining} attempt${remaining === 1 ? "" : "s"} remain.`;
  ctx.events.emit({
    type: "room3.fail",
    room: ROOM,
    message,
    data: { operativeIds, attemptsLeft: remaining, assessedDollars: 250 },
  });
  if (remaining === 0) {
    ctx.events.emit({
      type: "room3.exhausted",
      room: ROOM,
      message: "Room 3 reconstruction attempts exhausted.",
      data: { attempts: history.length },
    });
    return c.json({ result: "FAIL", attemptsLeft: 0 }, 409);
  }
  return c.json({ result: "FAIL", attemptsLeft: remaining });
});

app.get("/reconstruct/state", (c) => {
  const ctx = context;
  if (!ctx) return c.json({ error: "service not ready" }, 503);
  const config = roundConfig(ctx);
  if (!config || !configured(ctx)) return c.json({ error: "Room 3 is not configured" }, 409);
  const submitted = config.participants.flatMap((operativeId) => {
    if (!stateExists(ctx, operativeId, "submitted_share")) return [];
    const shareIndex = stateValue<number>(ctx, operativeId, "share_index");
    return typeof shareIndex === "number" ? [{ operativeId, shareIndex }] : [];
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
