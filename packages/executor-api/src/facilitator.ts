import { createKeyPairSignerFromBytes } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { x402Facilitator } from "@x402/core/facilitator";
import { validatePaymentPayload, validatePaymentRequirements } from "@x402/core/schemas";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { Hono } from "hono";
import bs58 from "bs58";
import type { AppContext } from "./context.ts";

export const SVM_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export interface SettledPayment {
  signature: string;
  payerPubkey: string;
  amount: bigint;
  destination: string;
  memo: string | null;
}

interface FacilitatorRuntime {
  facilitator: x402Facilitator;
}

interface FacilitatorRequest {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

let defaultContext: AppContext | undefined;
const runtimeByContext = new WeakMap<AppContext, Promise<FacilitatorRuntime>>();

/** Used by the existing index wiring, which constructs the listeners after room init. */
export function configureFacilitatorContext(ctx: AppContext): void {
  defaultContext = ctx;
}

function contextOrThrow(ctx?: AppContext): AppContext {
  const resolved = ctx ?? defaultContext;
  if (!resolved) throw new Error("facilitator context has not been initialized");
  return resolved;
}

async function runtime(ctx?: AppContext): Promise<FacilitatorRuntime> {
  const resolved = contextOrThrow(ctx);
  let pending = runtimeByContext.get(resolved);
  if (!pending) {
    pending = (async () => {
      // EstateChain caches and validates the keypair. Conversion to a kit signer is delayed
      // until the first facilitator operation, so process startup never needs Surfpool/files.
      const deployer = await resolved.chain.getDeployer();
      const kitSigner = await createKeyPairSignerFromBytes(deployer.secretKey);
      const signer = toFacilitatorSvmSigner(kitSigner, {
        defaultRpcUrl: resolved.config.rpcUrl,
      });
      const facilitator = new x402Facilitator().register(
        SVM_NETWORK,
        new ExactSvmScheme(signer),
      );
      return { facilitator };
    })();
    runtimeByContext.set(resolved, pending);
  }
  return pending;
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

function memoText(instruction: Record<string, unknown>): string | null {
  if (typeof instruction.parsed === "string") return instruction.parsed;
  const parsed = asRecord(instruction.parsed);
  if (parsed && typeof parsed.memo === "string") return parsed.memo;
  if (typeof instruction.data !== "string") return null;
  try {
    return Buffer.from(bs58.decode(instruction.data)).toString("utf8");
  } catch {
    return null;
  }
}

export function inspectParsedPaymentTransaction(transaction: unknown): Omit<SettledPayment, "signature"> {
  const root = asRecord(transaction);
  const tx = asRecord(root?.transaction);
  const message = asRecord(tx?.message);
  const meta = asRecord(root?.meta);
  const topLevel = Array.isArray(message?.instructions) ? message.instructions : [];
  const innerGroups = Array.isArray(meta?.innerInstructions) ? meta.innerInstructions : [];
  const inner = innerGroups.flatMap((group) => {
    const record = asRecord(group);
    return Array.isArray(record?.instructions) ? record.instructions : [];
  });
  const instructions = [...topLevel, ...inner]
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null);

  let payerPubkey: string | null = null;
  let destination: string | null = null;
  let amount: bigint | null = null;
  for (const instruction of instructions) {
    const parsed = asRecord(instruction.parsed);
    const info = asRecord(parsed?.info);
    if (parsed?.type !== "transferChecked" || !info) continue;
    const tokenAmount = asRecord(info.tokenAmount);
    const rawAmount = tokenAmount?.amount ?? info.amount;
    if (typeof rawAmount !== "string" && typeof rawAmount !== "number") continue;
    try { amount = BigInt(rawAmount); } catch { continue; }
    payerPubkey = publicKeyText(info.authority) ?? publicKeyText(info.owner);
    destination = publicKeyText(info.destination);
    if (payerPubkey && destination) break;
  }
  if (!payerPubkey || !destination || amount === null) {
    throw new Error("settled transaction has no inspectable TransferChecked instruction");
  }

  const memo = instructions
    .filter((instruction) => {
      return publicKeyText(instruction.programId) === MEMO_PROGRAM_ID
        || instruction.program === "spl-memo";
    })
    .map(memoText)
    .find((value): value is string => value !== null) ?? null;
  return { payerPubkey, amount, destination, memo };
}

export function decodeXPaymentHeader(header: string): PaymentPayload {
  if (!header.trim()) throw new Error("X-PAYMENT header is empty");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as unknown;
  } catch {
    throw new Error("X-PAYMENT header is not base64-encoded JSON");
  }
  const payload = validatePaymentPayload(decoded);
  if (payload.x402Version !== 2 || !("accepted" in payload)) {
    throw new Error("X-PAYMENT header must contain an x402 v2 payment payload");
  }
  return {
    x402Version: 2,
    accepted: normalizeRequirements(payload.accepted),
    payload: payload.payload,
  };
}

function normalizeRequirements(value: unknown): PaymentRequirements {
  const requirements = validatePaymentRequirements(value);
  if (!("amount" in requirements)) throw new Error("payment requirements must use x402 v2");
  return {
    scheme: requirements.scheme,
    network: requirements.network as PaymentRequirements["network"],
    amount: requirements.amount,
    asset: requirements.asset,
    payTo: requirements.payTo,
    maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    extra: requirements.extra ?? {},
  };
}

function parseFacilitatorRequest(value: unknown): FacilitatorRequest {
  const body = asRecord(value);
  if (!body) throw new Error("request body must be an object");
  const paymentPayload = validatePaymentPayload(body.paymentPayload);
  const paymentRequirements = normalizeRequirements(body.paymentRequirements);
  if (paymentPayload.x402Version !== 2 || !("accepted" in paymentPayload)
  ) {
    throw new Error("facilitator accepts x402 v2 requests only");
  }
  return {
    paymentPayload: {
      x402Version: 2,
      accepted: normalizeRequirements(paymentPayload.accepted),
      payload: paymentPayload.payload,
    },
    paymentRequirements,
  };
}

async function parsedTransaction(ctx: AppContext, signature: string): Promise<unknown> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const transaction = await ctx.chain.connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction) return transaction;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  throw new Error(`settled transaction ${signature} was confirmed but is not available for inspection`);
}

/**
 * Verify and settle through the same in-process facilitator used on :8701, then inspect
 * the confirmed transaction. Callers should compare accepted requirements before calling
 * this helper; the SDK then verifies the transaction itself against those requirements.
 */
export async function settleAndInspect(xPaymentHeader: string, ctx?: AppContext): Promise<SettledPayment> {
  const resolved = contextOrThrow(ctx);
  const paymentPayload = decodeXPaymentHeader(xPaymentHeader);
  const paymentRequirements = paymentPayload.accepted;
  const local = (await runtime(resolved)).facilitator;
  const verification = await local.verify(paymentPayload, paymentRequirements);
  if (!verification.isValid) {
    throw new Error(`payment verification failed: ${verification.invalidReason ?? "invalid payment"}`);
  }
  const settlement = await local.settle(paymentPayload, paymentRequirements);
  if (!settlement.success || !settlement.transaction) {
    throw new Error(`payment settlement failed: ${settlement.errorReason ?? "unknown failure"}`);
  }
  // ExactSvmScheme settles only after its signer has awaited confirmed commitment.
  const transaction = await parsedTransaction(resolved, settlement.transaction);
  return {
    signature: settlement.transaction,
    ...inspectParsedPaymentTransaction(transaction),
  };
}

export function recordTrapSettlement(ctx: AppContext, payerPubkey: string | null): string | null {
  const claimant = payerPubkey
    ? ctx.db.listClaimants().find((row) => row.pubkey === payerPubkey) ?? null
    : null;
  const claimNumber = claimant?.claim_number ?? null;
  if (claimNumber) ctx.db.setRoomState(claimNumber, "room3", "paid_via_trap", "1");
  ctx.events.emit({
    type: "room3.trap-settled",
    room: "room3",
    claimNumber,
    message: claimNumber
      ? `${claimNumber}: the Tempter thanks you for choosing the convenient witness.`
      : "The Tempter has accepted a payment from an heir who declined to name themselves.",
    data: { payerPubkey },
  });
  return claimNumber;
}

type AfterSettlement = (result: SettleResponse) => void;

function facilitatorApp(ctx?: AppContext, afterSettlement?: AfterSettlement): Hono {
  const app = new Hono();
  app.post("/verify", async (c) => {
    try {
      const request = parseFacilitatorRequest(await c.req.json<unknown>());
      const result: VerifyResponse = await (await runtime(ctx)).facilitator.verify(
        request.paymentPayload,
        request.paymentRequirements,
      );
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.post("/settle", async (c) => {
    try {
      const request = parseFacilitatorRequest(await c.req.json<unknown>());
      const result = await (await runtime(ctx)).facilitator.settle(
        request.paymentPayload,
        request.paymentRequirements,
      );
      if (result.success) afterSettlement?.(result);
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.get("/supported", async (c) => {
    try {
      return c.json((await runtime(ctx)).facilitator.getSupported());
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
  return app;
}

export function createHonestFacilitator(ctx?: AppContext): Hono {
  return facilitatorApp(ctx);
}

export function createTrapFacilitator(ctx?: AppContext): Hono {
  const resolved = contextOrThrow(ctx);
  return facilitatorApp(resolved, (result) => {
    recordTrapSettlement(resolved, typeof result.payer === "string" ? result.payer : null);
  });
}
