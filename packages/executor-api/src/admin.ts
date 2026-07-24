import { timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { PublicKey } from "@solana/web3.js";
import { fourDigit, fragment, hmac } from "./combos.ts";
import type { AppContext } from "./context.ts";

const CLAIM_PATTERN = /^[A-Za-z0-9-]{1,16}$/;
const ROOMS = new Set(["room1", "room2", "room3", "room4", "room5", "bonus"]);

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAdminAuthMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ") || !secureEqual(header.slice(7), token)) {
      return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }
    await next();
  };
}

export function deriveProbateNonce(secret: string, claimNumber: string): bigint {
  return hmac(secret, claimNumber, "nonce").readBigUInt64LE(0);
}

interface RegistryClaimant { claimNumber: string; pubkey: string; probateNonce: string }

async function appendClaimant(path: string, claimant: RegistryClaimant): Promise<void> {
  let current: unknown = [];
  try { current = JSON.parse(await readFile(path, "utf8")) as unknown; } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const wrapped = typeof current === "object" && current !== null && !Array.isArray(current)
    && Array.isArray((current as { claimants?: unknown }).claimants);
  const entries = (wrapped ? (current as { claimants: unknown[] }).claimants : current) as unknown;
  if (!Array.isArray(entries)) throw new Error(`Claimant registry ${path} must be an array or {claimants: []}`);
  const next = entries.filter((entry) => {
    return typeof entry !== "object" || entry === null
      || (entry as { claimNumber?: unknown }).claimNumber !== claimant.claimNumber;
  });
  next.push(claimant);
  await mkdir(dirname(path), { recursive: true });
  const registry = wrapped
    ? { ...(current as object), claimants: next }
    : { claimants: next };
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

async function runSeedScript(ctx: AppContext): Promise<Record<string, unknown>> {
  const script = join(ctx.config.deployDir, "src", "30-fund-and-seed.ts");
  try { await access(script, constants.R_OK); } catch {
    return { status: "skipped", reason: `deploy script absent at ${script}` };
  }
  const child = Bun.spawn(["bun", "run", script], {
    cwd: ctx.config.deployDir,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status: exitCode === 0 ? "completed" : "failed", exitCode, stdout, stderr };
}

function parsedRoomState(ctx: AppContext): Array<Record<string, unknown>> {
  return ctx.db.listRoomState().map((row) => {
    let value: unknown = row.value;
    try { value = JSON.parse(row.value) as unknown; } catch { /* preserve raw value */ }
    return { claimNumber: row.claim_number, room: row.room, key: row.key, value };
  });
}

export function createAdminApp(ctx: AppContext): Hono {
  const app = new Hono();
  app.use("*", createAdminAuthMiddleware(ctx.config.adminToken));

  app.post("/claimants", async (c) => {
    const body = await c.req.json<{ claimNumber?: unknown; pubkey?: unknown }>();
    if (typeof body.claimNumber !== "string" || !CLAIM_PATTERN.test(body.claimNumber)) {
      return c.json({ error: "claimNumber must match [A-Za-z0-9-] and be at most 16 characters" }, 400);
    }
    if (typeof body.pubkey !== "string") return c.json({ error: "pubkey is required" }, 400);
    try { new PublicKey(body.pubkey); } catch { return c.json({ error: "pubkey is not a Solana public key" }, 400); }

    const probateNonce = deriveProbateNonce(ctx.config.estateSecret, body.claimNumber).toString();
    ctx.db.upsertClaimant(body.claimNumber, body.pubkey, probateNonce);
    await appendClaimant(ctx.config.claimantRegistryPath, {
      claimNumber: body.claimNumber, pubkey: body.pubkey, probateNonce,
    });
    const funding = await runSeedScript(ctx);
    try {
      const record = await ctx.chain.getClaimRecord(body.claimNumber);
      if (record) ctx.db.updateClaimRecord(body.claimNumber, record.tributeAta, record.probateNonce.toString(), record.status);
    } catch (error) {
      funding.chainRefresh = { error: error instanceof Error ? error.message : String(error) };
    }
    const claimant = ctx.db.getClaimant(body.claimNumber);
    ctx.events.emit({
      type: "claimant.registered", claimNumber: body.claimNumber,
      message: `${body.claimNumber}: claim entered into probate.`, data: { funding },
    });
    return c.json({ claimant, funding }, 201);
  });

  app.post("/reveal", async (c) => {
    const body = await c.req.json<{ claimNumber?: unknown; room?: unknown }>();
    if (typeof body.room !== "string" || !ROOMS.has(body.room)) return c.json({ error: "invalid room" }, 400);
    if (body.claimNumber !== "all" && (typeof body.claimNumber !== "string" || !ctx.db.getClaimant(body.claimNumber))) {
      return c.json({ error: "claimant not found" }, 404);
    }
    const claims = body.claimNumber === "all"
      ? ctx.db.listClaimants().map((claimant) => claimant.claim_number)
      : [body.claimNumber];
    let changed = 0;
    for (const claimNumber of claims) {
      if (ctx.db.reveal(claimNumber, body.room)) {
        changed += 1;
        ctx.events.emit({
          type: "room.revealed", room: body.room, claimNumber,
          message: `${claimNumber}: ${body.room} clause opened for examination.`,
        });
      }
    }
    return c.json({ ok: true, room: body.room, claims, changed });
  });

  app.post("/mercy", async (c) => {
    const body = await c.req.json<{ claimNumber?: unknown; room?: unknown }>();
    if (typeof body.claimNumber !== "string" || !ctx.db.getClaimant(body.claimNumber)) {
      return c.json({ error: "claimant not found" }, 404);
    }
    if (typeof body.room !== "string" || !ROOMS.has(body.room)) return c.json({ error: "invalid room" }, 400);
    const unlock = body.room === "room3"
      ? { fragment: fragment(body.claimNumber, body.room, 12, ctx.config.estateSecret) }
      : { combo: fourDigit(body.claimNumber, body.room, ctx.config.estateSecret) };
    const message = `${body.claimNumber}: mercy granted. The deficiency has been priced against the estate.`;
    const event = ctx.events.emit({
      type: "mercy.granted", room: body.room, claimNumber: body.claimNumber, message, data: unlock,
    });
    return c.json({ ok: true, ...unlock, event });
  });

  app.get("/state", (c) => {
    const events = ctx.db.recentEvents(100).map((event) => {
      let data: unknown = event.data;
      try { data = JSON.parse(event.data) as unknown; } catch { /* preserve raw data */ }
      return { ...event, data };
    });
    return c.json({
      claimants: ctx.db.listClaimants(),
      reveals: ctx.db.listReveals(),
      roomState: parsedRoomState(ctx),
      recentEvents: events,
      room5Scoreboard: [],
    });
  });

  app.get("/events", (c) => new Response(ctx.events.stream(50, c.req.raw.signal), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  }));

  app.get("/health", (c) => c.json({ ok: true, service: "executor-api", ts: new Date().toISOString() }));

  app.onError((error, c) => {
    console.error("[admin]", error);
    return c.json({ error: "executor administration failed" }, 500);
  });
  return app;
}
