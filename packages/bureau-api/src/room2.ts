import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Hono, type Context } from "hono";
import { fourDigit, hmac } from "./combos.ts";
import type { AppContext } from "./context.ts";
import {
  configureFacilitatorContext,
  decodeXPaymentHeader,
  settleAndInspect,
  SVM_NETWORK,
  type SettledPayment,
} from "./facilitator.ts";

const MAX_TIMEOUT_SECONDS = 120;
const HOP_A_AMOUNT = 2_500n;
const HOP_B_BASE = 4_000n;
const HOP_B_MODULUS = 6_000n;
const MISSING_BRIEF = { error: "room not revealed for this operative" } as const;

export interface Room2Resources {
  mint: string;
  feePayer: string;
  componentOwner: string;
  componentAta: string;
}

export interface Room2Dependencies {
  loadResources: () => Promise<Room2Resources>;
  settle: (header: string) => Promise<SettledPayment>;
  ensureVaultTokenAccount: (owner: string, mint: string) => Promise<void>;
}

export function room2Nonces(secret: string, operativeId: string): { nonceA: string; nonceB: string } {
  return {
    nonceA: hmac(secret, operativeId, "room2:nonceA").toString("hex").slice(0, 16),
    nonceB: hmac(secret, operativeId, "room2:nonceB").toString("hex").slice(0, 16),
  };
}

export function room2HopBAmount(nonceB: string): bigint {
  if (!/^[0-9a-f]{16}$/i.test(nonceB)) throw new Error("Room 2 carry must be 16 hexadecimal characters");
  return HOP_B_BASE + (BigInt(`0x${nonceB}`) % HOP_B_MODULUS);
}

export function room2VaultOwner(secret: string, operativeId: string): PublicKey {
  // The seed-derived secret is intentionally discarded. The address only needs to own a
  // receivable ATA; neither the Bureau nor an operative needs to spend from this vault.
  return Keypair.fromSeed(hmac(secret, operativeId, "room2:vault")).publicKey;
}

export function room2ComponentIndex(operativeId: string): number {
  const suffix = /([0-9]+)$/.exec(operativeId)?.[1];
  if (suffix) return Number((BigInt(suffix) - 1n + 12n) % 12n) + 1;
  return (hmac("room2-component-index", operativeId, "stable").readUInt32BE(0) % 12) + 1;
}

function isRevealed(ctx: AppContext, operativeId: string): boolean {
  return ctx.db.listReveals().some((row) => {
    return row.operative_id === operativeId && row.room === "room2";
  });
}

function roomState(ctx: AppContext, operativeId: string, key: string): unknown {
  const row = ctx.db.listRoomState().find((candidate) => {
    return candidate.operative_id === operativeId
      && candidate.room === "room2"
      && candidate.key === key;
  });
  if (!row) return undefined;
  try { return JSON.parse(row.value) as unknown; } catch { return row.value; }
}

function emitRejection(
  ctx: AppContext,
  operativeId: string,
  stage: string,
  diagnostics: Record<string, unknown>,
): void {
  ctx.events.emit({
    type: "room2.rejected",
    room: "room2",
    operativeId,
    message: `${operativeId}: submission rejected.`,
    data: { stage, ...diagnostics },
  });
}

function vaultFor(ctx: AppContext, operativeId: string, mint: string): { owner: string; ata: string } {
  const owner = room2VaultOwner(ctx.config.bureauSecret, operativeId);
  return {
    owner: owner.toBase58(),
    ata: getAssociatedTokenAddressSync(new PublicKey(mint), owner).toBase58(),
  };
}

function requirement(
  amount: string,
  mint: string,
  payToOwner: string,
  feePayer: string,
  extra: Record<string, unknown>,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: SVM_NETWORK,
    amount,
    asset: mint,
    payTo: payToOwner,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { feePayer, ...extra },
  };
}

function paymentRequired(
  resource: string,
  payment: PaymentRequirements,
  error = "payment required",
): Record<string, unknown> {
  return {
    x402Version: 2,
    error,
    resource: {
      url: resource,
      ["descr" + "iption"]: "Room 2 verification fee",
      mimeType: "application/json",
    },
    accepts: [payment],
  };
}

function acceptedMatches(
  payload: PaymentPayload,
  expected: PaymentRequirements,
): { matches: boolean; diagnostics: Record<string, unknown> } {
  const accepted = payload.accepted;
  const matches = payload.x402Version === 2
    && accepted.scheme === expected.scheme
    && accepted.network === expected.network
    && accepted.amount === expected.amount
    && accepted.asset === expected.asset
    && accepted.payTo === expected.payTo
    && accepted.extra?.feePayer === expected.extra.feePayer;
  return {
    matches,
    diagnostics: {
      acceptedAmount: accepted.amount,
      expectedAmount: expected.amount,
      acceptedAsset: accepted.asset,
      acceptedPayTo: accepted.payTo,
      expectedPayTo: expected.payTo,
      acceptedNetwork: accepted.network,
    },
  };
}

function defaultDependencies(ctx: AppContext): Room2Dependencies {
  let resources: Promise<Room2Resources> | undefined;
  return {
    loadResources: () => {
      resources ??= Promise.all([ctx.chain.getDeployer(), ctx.chain.getCredMint()]).then(
        ([deployer, mint]) => ({
          mint: mint.toBase58(),
          feePayer: deployer.publicKey.toBase58(),
          componentOwner: deployer.publicKey.toBase58(),
          componentAta: getAssociatedTokenAddressSync(mint, deployer.publicKey).toBase58(),
        }),
      );
      return resources;
    },
    settle: (header) => settleAndInspect(header, ctx),
    ensureVaultTokenAccount: async (owner, mint) => {
      const response = await fetch(ctx.config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `room2-vault-${owner}`,
          method: "surfnet_setTokenAccount",
          params: [owner, mint, { amount: 0 }, TOKEN_PROGRAM_ID.toBase58()],
        }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok || result.error) {
        throw new Error(result.error?.message ?? `Surfpool returned HTTP ${response.status}`);
      }
    },
  };
}

export function createRoom2App(
  ctx: AppContext,
  overrides: Partial<Room2Dependencies> = {},
): Hono {
  const defaults = defaultDependencies(ctx);
  const dependencies: Room2Dependencies = { ...defaults, ...overrides };
  const room = new Hono();

  room.get("/component/:operative", async (c) => {
    const operativeId = c.req.param("operative");
    if (!isRevealed(ctx, operativeId)) {
      emitRejection(ctx, operativeId, "gate", { reason: "room_not_revealed" });
      return c.json(MISSING_BRIEF, 404);
    }
    const { nonceA, nonceB } = room2Nonces(ctx.config.bureauSecret, operativeId);
    let resources: Room2Resources;
    try {
      resources = await dependencies.loadResources();
    } catch (error) {
      emitRejection(ctx, operativeId, "component", { reason: "bureau_resources_unavailable", error: String(error) });
      return c.json({ error: "verification service not ready" }, 503);
    }
    const expected = requirement(
      HOP_A_AMOUNT.toString(),
      resources.mint,
      resources.componentOwner,
      resources.feePayer,
      { memoRequired: nonceA, exact: true },
    );
    const challenge = paymentRequired(`/component/${operativeId}`, expected);
    const paymentHeader = c.req.header("x-payment");
    if (!paymentHeader) return c.json(challenge, 402);

    let payload: PaymentPayload;
    try {
      payload = decodeXPaymentHeader(paymentHeader);
    } catch (error) {
      emitRejection(ctx, operativeId, "hopA", { reason: "malformed_payment_header", error: String(error) });
      return c.json(paymentRequired(`/component/${operativeId}`, expected, "payment header is invalid"), 402);
    }
    const accepted = acceptedMatches(payload, expected);
    if (!accepted.matches) {
      emitRejection(ctx, operativeId, "hopA", { reason: "requirements_mismatch", ...accepted.diagnostics });
      return c.json(paymentRequired(`/component/${operativeId}`, expected, "payment amount is not exact"), 402);
    }

    let settlement: SettledPayment;
    try {
      settlement = await dependencies.settle(paymentHeader);
    } catch (error) {
      emitRejection(ctx, operativeId, "hopA", { reason: "verification_or_settlement_failed", error: String(error) });
      return c.json(paymentRequired(`/component/${operativeId}`, expected, "payment verification failed"), 402);
    }
    if (settlement.amount !== HOP_A_AMOUNT || settlement.destination !== resources.componentAta) {
      emitRejection(ctx, operativeId, "hopA", {
        reason: "settled_transfer_mismatch",
        signature: settlement.signature,
        amount: settlement.amount.toString(),
        destination: settlement.destination,
      });
      return c.json(paymentRequired(`/component/${operativeId}`, expected, "payment amount is not exact"), 402);
    }

    const nextBrief = `/authorize/${operativeId}`;
    if (settlement.memo !== nonceA) {
      ctx.events.emit({
        type: "room2.fee-kept",
        room: "room2",
        operativeId,
        message: `${operativeId}: fee received without required authorization memo; fee retained.`,
        data: { signature: settlement.signature },
      });
      return c.json({
        status: "SEALED",
        reason: "fee received without required authorization memo; fee retained.",
        nextBrief,
        carry: nonceB,
      });
    }

    ctx.db.setRoomState(operativeId, "room2", "hopA", "PAID");
    ctx.events.emit({
      type: "room2.hopA",
      room: "room2",
      operativeId,
      message: `${operativeId}: fee accepted; authorization pending.`,
      data: { signature: settlement.signature },
    });
    return c.json({
      status: "FEE ACCEPTED. AUTHORIZATION PENDING.",
      nextBrief,
      carry: nonceB,
    });
  });

  room.get("/authorize/:operative", async (c) => {
    const operativeId = c.req.param("operative");
    if (!isRevealed(ctx, operativeId)) {
      emitRejection(ctx, operativeId, "gate", { reason: "room_not_revealed" });
      return c.json(MISSING_BRIEF, 404);
    }
    const { nonceB } = room2Nonces(ctx.config.bureauSecret, operativeId);
    if (c.req.header("x-carry") !== nonceB) {
      emitRejection(ctx, operativeId, "hopB", { reason: "carry_mismatch" });
      return c.json({ error: "the authorization chain is not intact" }, 400);
    }
    if (roomState(ctx, operativeId, "hopA") !== "PAID") {
      emitRejection(ctx, operativeId, "hopB", { reason: "hopA_not_paid" });
      return c.json({ error: "Room 2 first payment is not recorded" }, 403);
    }

    let resources: Room2Resources;
    try {
      resources = await dependencies.loadResources();
    } catch (error) {
      emitRejection(ctx, operativeId, "authorize", { reason: "bureau_resources_unavailable", error: String(error) });
      return c.json({ error: "verification service not ready" }, 503);
    }
    const vault = vaultFor(ctx, operativeId, resources.mint);
    try {
      await dependencies.ensureVaultTokenAccount(vault.owner, resources.mint);
    } catch (error) {
      emitRejection(ctx, operativeId, "authorize", { reason: "vault_unavailable", error: String(error) });
      return c.json({ error: "the authorization vault is unavailable" }, 503);
    }
    const amount = room2HopBAmount(nonceB);
    // ExactSvmScheme clients parse PaymentRequirements.amount and would automatically pay a
    // stated value. Advertising zero intentionally makes that naive transaction fail; an operative
    // must compute the formula and replace accepted.amount while hand-building X-PAYMENT.
    const advertised = requirement(
      "0",
      resources.mint,
      vault.owner,
      resources.feePayer,
      { amountFormula: "4000 + (nonce_B mod 6000)" },
    );
    const expected = { ...advertised, amount: amount.toString() };
    const challenge = paymentRequired(`/authorize/${operativeId}`, advertised);
    const paymentHeader = c.req.header("x-payment");
    if (!paymentHeader) return c.json(challenge, 402);

    let payload: PaymentPayload;
    try {
      payload = decodeXPaymentHeader(paymentHeader);
    } catch (error) {
      emitRejection(ctx, operativeId, "hopB", { reason: "malformed_payment_header", error: String(error) });
      return c.json(paymentRequired(`/authorize/${operativeId}`, advertised, "payment header is invalid"), 402);
    }
    const accepted = acceptedMatches(payload, expected);
    if (!accepted.matches) {
      emitRejection(ctx, operativeId, "hopB", { reason: "requirements_mismatch", ...accepted.diagnostics });
      return c.json(paymentRequired(`/authorize/${operativeId}`, advertised, "the authorization amount is not exact"), 402);
    }

    let settlement: SettledPayment;
    try {
      settlement = await dependencies.settle(paymentHeader);
    } catch (error) {
      emitRejection(ctx, operativeId, "hopB", { reason: "verification_or_settlement_failed", error: String(error) });
      return c.json(paymentRequired(`/authorize/${operativeId}`, advertised, "authorization verification failed"), 402);
    }
    if (settlement.amount !== amount || settlement.destination !== vault.ata) {
      emitRejection(ctx, operativeId, "hopB", {
        reason: "settled_transfer_mismatch",
        signature: settlement.signature,
        amount: settlement.amount.toString(),
        destination: settlement.destination,
        expectedDestination: vault.ata,
      });
      return c.json(paymentRequired(`/authorize/${operativeId}`, advertised, "the authorization amount is not exact"), 402);
    }

    const combo = fourDigit(operativeId, "room2", ctx.config.bureauSecret);
    const component = `COMPONENT-${room2ComponentIndex(operativeId)}`;
    ctx.db.setRoomState(operativeId, "room2", "hopB", "PAID");
    ctx.events.emit({
      type: "room2.unsealed",
      room: "room2",
      operativeId,
      message: `${operativeId}: Room 2 verified; component released.`,
      data: { signature: settlement.signature, component },
    });
    ctx.events.emit({
      type: "combo.reveal",
      room: "room2",
      operativeId,
      message: `${operativeId}: Room 2 unlock released.`,
      data: { combo },
    });
    return c.json({ status: "UNSEALED", lockboxCombo: combo, component });
  });

  return room;
}

let initializedApp: Hono | undefined;

// Route-scoped delegation: a bare `.all("*")` here would swallow every path on
// the shared public listener mounted after us.
const delegate = (c: Context) => {
  if (!initializedApp) return c.json({ error: "service not ready" }, 503);
  return initializedApp.fetch(c.req.raw);
};

export const app = new Hono()
  .all("/component/:operative", delegate)
  .all("/authorize/:operative", delegate);

export async function init(
  ctx: AppContext,
  overrides: Partial<Room2Dependencies> = {},
): Promise<void> {
  configureFacilitatorContext(ctx);
  const defaults = defaultDependencies(ctx);
  const dependencies: Room2Dependencies = { ...defaults, ...overrides };
  initializedApp = createRoom2App(ctx, dependencies);

  const revealed = ctx.db.listReveals().filter((row) => row.room === "room2");
  if (revealed.length === 0) return;
  try {
    const resources = await dependencies.loadResources();
    for (const row of revealed) {
      const vault = vaultFor(ctx, row.operative_id, resources.mint);
      try {
        await dependencies.ensureVaultTokenAccount(vault.owner, resources.mint);
      } catch (error) {
        emitRejection(ctx, row.operative_id, "init", { reason: "vault_initialization_failed", error: String(error) });
      }
    }
  } catch (error) {
    for (const row of revealed) {
      emitRejection(ctx, row.operative_id, "init", { reason: "bureau_resources_unavailable", error: String(error) });
    }
  }
}
