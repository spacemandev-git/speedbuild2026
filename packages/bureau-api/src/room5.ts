import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Hono, type Context } from "hono";
import { flashSeconds, hmac } from "./combos.ts";
import type { AppContext } from "./context.ts";
import * as facilitator from "./facilitator.ts";

const PAYMENT_AMOUNT = 200n;
const X402_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEFAULT_DECOY_POSITIONS = [3, 6] as const;
const ROUTE_LENGTH = 7;

const HINTS = [
  "Start with the posted entry, not the alternate entry.",
  "Follow the posted route and ignore imitations.",
  "Advance through the route; reflected addresses are decoys.",
  "Use the compact entry and reject decorated alternatives.",
  "The route is fixed for each operative.",
  "Use the named node and do not pay its decoy.",
  "Complete the final route entry.",
] as const;

const DECOY_HINT = "Use the n_ entry and leave the d_ decoy unpaid.";

export interface Room5Route {
  nodes: string[];
  decoys: Map<number, string>;
}

export interface SettlementInspection {
  signature: string;
  payerPubkey: string;
  amount: bigint;
  destination: string;
  memo: string | null;
}

export type Room5Settler = (xPaymentHeader: string) => Promise<SettlementInspection>;

interface HopPayload {
  hop: number;
  next: string;
  hint: string;
  decoy_of_next?: string;
}

interface FinalPayload {
  hops_correct: number;
  flash_seconds: number;
  token: string;
}

interface CorruptedPayload { corrupted: true }
type StoredPayload = HopPayload | FinalPayload | CorruptedPayload;

interface TraversalState {
  version: 1;
  currentPosition: number;
  decoysPaid: number;
  skipped: number;
  streakBroken: boolean;
  completed: boolean;
  responses: Record<string, StoredPayload>;
}

export interface Room5Score {
  operativeId: string;
  hops_correct: number;
  flash_seconds: number;
  token: string;
  completed_at: string;
}

interface PaymentTerms {
  scheme: "exact";
  network: typeof X402_NETWORK;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { feePayer: string };
}

interface Room5Runtime {
  ctx: AppContext;
  settle: Room5Settler;
}

function defaultSettler(ctx: AppContext): Room5Settler {
  // The facilitator owns settlement. Keeping the adapter here makes an upstream
  // export rename a one-line change while preserving a strict Room 5 boundary.
  const settleAndInspect = (facilitator as unknown as {
    settleAndInspect?: Room5Settler;
  }).settleAndInspect;
  if (!settleAndInspect) return async () => { throw new Error("the settlement desk is not yet seated"); };
  return (xPaymentHeader) => (settleAndInspect as unknown as (
    header: string,
    context: AppContext,
  ) => Promise<SettlementInspection>)(xPaymentHeader, ctx);
}

export function deriveRoom5Route(secret: string, operativeId: string, decoyPositions: readonly number[] = DEFAULT_DECOY_POSITIONS): Room5Route {
  const nodes = Array.from({ length: ROUTE_LENGTH }, (_, index) => {
    const position = index + 1;
    return `n_${hmac(secret, operativeId, `room5:pos:${position}`).toString("hex").slice(0, 4)}`;
  });
  const decoys = new Map<number, string>();
  for (const position of decoyPositions) {
    if (Number.isInteger(position) && position >= 2 && position <= ROUTE_LENGTH) {
      decoys.set(position, `d_${hmac(secret, operativeId, `room5:decoy:${position}`).toString("hex").slice(0, 4)}`);
    }
  }
  return { nodes, decoys };
}

function initialState(): TraversalState {
  return {
    version: 1,
    currentPosition: 1,
    decoysPaid: 0,
    skipped: 0,
    streakBroken: false,
    completed: false,
    responses: {},
  };
}

function readJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function loadTraversal(ctx: AppContext, operativeId: string): TraversalState {
  return readJson(ctx.db.getRoomState(operativeId, "room5", "traversal"), initialState());
}

function configuredDecoys(ctx: AppContext, operativeId: string): number[] {
  const rows = ctx.db.listRoomState().filter((row) => row.room === "room5"
    && (row.operative_id === "*" || row.operative_id === operativeId)
    && (row.key === "config" || row.key === "decoy_positions"));
  let positions: unknown = DEFAULT_DECOY_POSITIONS;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value) as unknown;
      positions = row.key === "config" && typeof parsed === "object" && parsed !== null
        ? (parsed as { decoyPositions?: unknown; decoy_positions?: unknown }).decoyPositions
          ?? (parsed as { decoy_positions?: unknown }).decoy_positions
          ?? positions
        : parsed;
    } catch { /* an invalid production override does not alter the default route */ }
  }
  if (!Array.isArray(positions)) return [...DEFAULT_DECOY_POSITIONS];
  const normalized = positions.filter((item): item is number => Number.isInteger(item) && Number(item) >= 2 && Number(item) <= ROUTE_LENGTH);
  return [...new Set(normalized)];
}

async function paymentTerms(ctx: AppContext): Promise<PaymentTerms> {
  const [mint, deployer] = await Promise.all([ctx.chain.getCredMint(), ctx.chain.getDeployer()]);
  const payTo = getAssociatedTokenAddressSync(mint, deployer.publicKey).toBase58();
  return {
    scheme: "exact",
    network: X402_NETWORK,
    amount: PAYMENT_AMOUNT.toString(),
    asset: mint.toBase58(),
    payTo,
    maxTimeoutSeconds: 300,
    extra: { feePayer: deployer.publicKey.toBase58() },
  };
}

function paymentRequired(terms: PaymentTerms): { x402Version: 2; error: string; accepts: PaymentTerms[] } {
  return {
    x402Version: 2,
    error: "Room 5 requires settlement before this node may be read.",
    accepts: [terms],
  };
}

function paymentHeaderAccepts(header: string, terms: PaymentTerms): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as unknown;
    if (typeof decoded !== "object" || decoded === null) return false;
    const envelope = decoded as { x402Version?: unknown; accepted?: unknown };
    if (envelope.x402Version !== 2 || typeof envelope.accepted !== "object" || envelope.accepted === null) return false;
    const accepted = envelope.accepted as Record<string, unknown>;
    const extra = typeof accepted.extra === "object" && accepted.extra !== null
      ? accepted.extra as Record<string, unknown>
      : {};
    return accepted.scheme === terms.scheme
      && accepted.network === terms.network
      && accepted.amount === terms.amount
      && accepted.asset === terms.asset
      && accepted.payTo === terms.payTo
      && accepted.maxTimeoutSeconds === terms.maxTimeoutSeconds
      && extra.feePayer === terms.extra.feePayer;
  } catch {
    return false;
  }
}

function hopPayload(position: number, route: Room5Route): HopPayload {
  const nextPosition = position + 1;
  const next = route.nodes[nextPosition - 1];
  if (!next) throw new Error(`room5 route has no position ${nextPosition}`);
  const decoy = route.decoys.get(nextPosition);
  return {
    hop: position,
    next,
    hint: decoy ? DECOY_HINT : HINTS[position - 1] ?? "No further route guidance is available.",
    ...(decoy ? { decoy_of_next: decoy } : {}),
  };
}

const operativeLocks = new Map<string, Promise<void>>();

async function withOperativeLock<T>(operativeId: string, work: () => Promise<T>): Promise<T> {
  const previous = operativeLocks.get(operativeId) ?? Promise.resolve();
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  operativeLocks.set(operativeId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (operativeLocks.get(operativeId) === tail) operativeLocks.delete(operativeId);
  }
}

function createRouter(runtime: () => Room5Runtime | null): Hono {
  const router = new Hono();

  const handle = async (c: Context, requestedId: string) => {
    const active = runtime();
    if (!active) return c.json({ error: "service not ready" }, 503);
    const operativeId = c.req.query("operative");
    if (!operativeId || !active.ctx.db.getOperative(operativeId)) {
      return c.json({ error: "operative not found" }, 400);
    }

    return withOperativeLock(operativeId, async () => {
      const state = loadTraversal(active.ctx, operativeId);
      const stored = state.responses[requestedId];
      if (stored) return c.json(stored);

      const route = deriveRoom5Route(active.ctx.config.bureauSecret, operativeId, configuredDecoys(active.ctx, operativeId));
      let position: number | undefined;
      let decoy = false;
      if (requestedId === "start") position = 1;
      else {
        const nodeIndex = route.nodes.indexOf(requestedId);
        if (nodeIndex >= 0) position = nodeIndex + 1;
        for (const [candidatePosition, candidateId] of route.decoys) {
          if (candidateId === requestedId) {
            position = candidatePosition;
            decoy = true;
            break;
          }
        }
        if (position === undefined) return c.json({ error: "unknown route node" }, 404);
      }

      if (state.completed || position !== state.currentPosition) {
        return c.json({ error: "route node is out of order" }, 409);
      }

      let terms: PaymentTerms;
      try {
        terms = await paymentTerms(active.ctx);
      } catch {
        return c.json({ error: "service not ready" }, 503);
      }
      const paymentHeader = c.req.header("X-PAYMENT");
      if (!paymentHeader) return c.json(paymentRequired(terms), 402);
      if (!paymentHeaderAccepts(paymentHeader, terms)) return c.json(paymentRequired(terms), 402);

      let settlement: SettlementInspection;
      try {
        settlement = await active.settle(paymentHeader);
      } catch {
        return c.json(paymentRequired(terms), 402);
      }
      if (settlement.amount !== PAYMENT_AMOUNT || settlement.destination !== terms.payTo) {
        return c.json(paymentRequired(terms), 402);
      }

      if (decoy) {
        const payload: CorruptedPayload = { corrupted: true };
        state.decoysPaid += 1;
        state.streakBroken = true;
        state.responses[requestedId] = payload;
        active.ctx.db.setRoomState(operativeId, "room5", "traversal", state);
        active.ctx.events.emit({
          type: "room5.decoy-paid",
          room: "room5",
          operativeId,
          message: `${operativeId}: decoy node payment recorded.`,
          data: { operativeId, node: requestedId, position, signature: settlement.signature, payerPubkey: settlement.payerPubkey },
        });
        return c.json(payload);
      }

      if (position < ROUTE_LENGTH) {
        const payload = hopPayload(position, route);
        state.responses[requestedId] = payload;
        if (position === 1) {
          state.responses.start = payload;
          const firstNode = route.nodes[0];
          if (firstNode) state.responses[firstNode] = payload;
        }
        state.currentPosition = position + 1;
        active.ctx.db.setRoomState(operativeId, "room5", "traversal", state);
        return c.json(payload);
      }

      const hopsCorrect = Math.max(0, ROUTE_LENGTH - state.decoysPaid - state.skipped);
      const score: Room5Score = {
        operativeId,
        hops_correct: hopsCorrect,
        flash_seconds: flashSeconds(hopsCorrect),
        token: hmac(active.ctx.config.bureauSecret, operativeId, `room5:token:${hopsCorrect}`).toString("hex").slice(0, 32),
        completed_at: new Date().toISOString(),
      };
      const payload: FinalPayload = {
        hops_correct: score.hops_correct,
        flash_seconds: score.flash_seconds,
        token: score.token,
      };
      state.responses[requestedId] = payload;
      state.currentPosition = ROUTE_LENGTH + 1;
      state.completed = true;
      active.ctx.db.setRoomState(operativeId, "room5", "traversal", state);
      active.ctx.db.setRoomState(operativeId, "room5", "scoreboard", score);
      active.ctx.events.emit({
        type: "room5.route-complete",
        room: "room5",
        operativeId,
        message: `${operativeId} — ROUTE ${score.hops_correct}/7 — ${score.flash_seconds}s`,
        data: { ...score, decoysPaid: state.decoysPaid, skipped: state.skipped, settlementSignature: settlement.signature },
      });
      return c.json(payload);
    });
  };

  router.get("/node/start", (c) => handle(c, "start"));
  router.get("/node/:id", (c) => handle(c, c.req.param("id")));
  router.get("/scoreboard", (c) => {
    const active = runtime();
    if (!active) return c.json({ error: "service not ready" }, 503);
    const scores = active.ctx.db.listRoomState()
      .filter((row) => row.room === "room5" && row.key === "scoreboard")
      .flatMap((row) => {
        try { return [JSON.parse(row.value) as Room5Score]; } catch { return []; }
      })
      .sort((left, right) => left.operativeId.localeCompare(right.operativeId));
    return c.json(scores);
  });
  return router;
}

let productionRuntime: Room5Runtime | null = null;

export const app = createRouter(() => productionRuntime);

export function createRoom5App(ctx: AppContext, settle: Room5Settler = defaultSettler(ctx)): Hono {
  return createRouter(() => ({ ctx, settle }));
}

export async function init(ctx: AppContext): Promise<void> {
  productionRuntime = { ctx, settle: defaultSettler(ctx) };
}
