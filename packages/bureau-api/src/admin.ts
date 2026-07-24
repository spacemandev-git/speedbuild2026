import { timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { PublicKey } from "@solana/web3.js";
import { fourDigit, fragment, hmac, lockAssignments } from "./combos.ts";
import type { AppContext } from "./context.ts";

const OPERATIVE_PATTERN = /^[A-Za-z0-9-]{1,16}$/;
const ROOMS = new Set(["room1", "room2", "room3", "room4", "room5"]);

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

export function deriveClearanceNonce(secret: string, operativeId: string): bigint {
  return hmac(secret, operativeId, "nonce").readBigUInt64LE(0);
}

interface RegistryOperative { operativeId: string; pubkey: string; clearanceNonce: string }

async function appendOperative(path: string, operative: RegistryOperative): Promise<void> {
  let current: unknown = [];
  try { current = JSON.parse(await readFile(path, "utf8")) as unknown; } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const wrapped = typeof current === "object" && current !== null && !Array.isArray(current)
    && Array.isArray((current as { operatives?: unknown }).operatives);
  const entries = (wrapped ? (current as { operatives: unknown[] }).operatives : current) as unknown;
  if (!Array.isArray(entries)) throw new Error(`Operative registry ${path} must be an array or {operatives: []}`);
  const next = entries.filter((entry) => {
    return typeof entry !== "object" || entry === null
      || (entry as { operativeId?: unknown }).operativeId !== operative.operativeId;
  });
  next.push(operative);
  await mkdir(dirname(path), { recursive: true });
  const registry = wrapped
    ? { ...(current as object), operatives: next }
    : { operatives: next };
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

async function runSeedCommand(ctx: AppContext): Promise<Record<string, unknown>> {
  const seedProgram = join(ctx.config.deployDir, "src", "30-fund-and-seed.ts");
  try { await access(seedProgram, constants.R_OK); } catch {
    return { status: "skipped", reason: `deploy program absent at ${seedProgram}` };
  }
  const child = Bun.spawn(["bun", "run", seedProgram], {
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
    return { operativeId: row.operative_id, room: row.room, key: row.key, value };
  });
}

export function createAdminApp(ctx: AppContext): Hono {
  const app = new Hono();
  const operativePool = ctx.config.operativePool ?? 24;
  app.use("*", createAdminAuthMiddleware(ctx.config.adminToken));

  app.post("/operatives", async (c) => {
    const body = await c.req.json<{ operativeId?: unknown; pubkey?: unknown }>();
    if (typeof body.operativeId !== "string" || !OPERATIVE_PATTERN.test(body.operativeId)) {
      return c.json({ error: "operativeId must match [A-Za-z0-9-] and be at most 16 characters" }, 400);
    }
    if (typeof body.pubkey !== "string") return c.json({ error: "pubkey is required" }, 400);
    try { new PublicKey(body.pubkey); } catch { return c.json({ error: "pubkey is not a Solana public key" }, 400); }

    const clearanceNonce = deriveClearanceNonce(ctx.config.bureauSecret, body.operativeId).toString();
    ctx.db.upsertOperative(body.operativeId, body.pubkey, clearanceNonce);
    await appendOperative(ctx.config.operativeRegistryPath, {
      operativeId: body.operativeId, pubkey: body.pubkey, clearanceNonce,
    });
    const funding = await runSeedCommand(ctx);
    try {
      const record = await ctx.chain.getVerificationRecord(body.operativeId);
      if (record) ctx.db.updateVerificationRecord(
        body.operativeId,
        record.clearanceAta,
        record.clearanceNonce.toString(),
        record.status,
      );
    } catch (error) {
      funding.chainRefresh = { error: error instanceof Error ? error.message : String(error) };
    }
    const operative = ctx.db.getOperative(body.operativeId);
    ctx.events.emit({
      type: "operative.registered", operativeId: body.operativeId,
      message: `${body.operativeId}: operative registered.`, data: { funding },
    });
    return c.json({ operative, funding }, 201);
  });

  app.post("/reveal", async (c) => {
    const body = await c.req.json<{ operativeId?: unknown; room?: unknown }>();
    if (typeof body.room !== "string" || !ROOMS.has(body.room)) return c.json({ error: "invalid room" }, 400);
    if (body.operativeId !== "all" && (typeof body.operativeId !== "string" || !ctx.db.getOperative(body.operativeId))) {
      return c.json({ error: "operative not found" }, 404);
    }
    const operatives = body.operativeId === "all"
      ? ctx.db.listOperatives().map((operative) => operative.operative_id)
      : [body.operativeId];
    let changed = 0;
    for (const operativeId of operatives) {
      if (ctx.db.reveal(operativeId, body.room)) {
        changed += 1;
        ctx.events.emit({
          type: "room.revealed", room: body.room, operativeId,
          message: `${operativeId}: ${body.room} access revealed.`,
        });
      }
    }
    return c.json({ ok: true, room: body.room, operatives, changed });
  });

  app.post("/override", async (c) => {
    const body = await c.req.json<{ operativeId?: unknown; room?: unknown }>();
    if (typeof body.operativeId !== "string" || !OPERATIVE_PATTERN.test(body.operativeId)) {
      return c.json({ error: "invalid operativeId" }, 400);
    }
    if (typeof body.room !== "string" || !ROOMS.has(body.room)) return c.json({ error: "invalid room" }, 400);
    const unlock = body.room === "room3"
      ? { fragment: fragment(body.operativeId, body.room, 12, ctx.config.bureauSecret) }
      : { combo: fourDigit(body.operativeId, body.room, ctx.config.bureauSecret) };
    const message = `${body.operativeId}: manual override — ${body.room} unlock released.`;
    const event = ctx.events.emit({
      type: "override.granted", room: body.room, operativeId: body.operativeId, message, data: unlock,
    });
    return c.json({ ok: true, ...unlock, event });
  });

  app.post("/force-complete", async (c) => {
    const body = await c.req.json<{ operativeId?: unknown; room?: unknown }>();
    if (typeof body.operativeId !== "string" || !OPERATIVE_PATTERN.test(body.operativeId)) {
      return c.json({ error: "invalid operativeId" }, 400);
    }
    if (typeof body.room !== "string" || !ROOMS.has(body.room)) return c.json({ error: "invalid room" }, 400);
    const unlock = body.room === "room3"
      ? { fragment: fragment(body.operativeId, body.room, 12, ctx.config.bureauSecret) }
      : { combo: fourDigit(body.operativeId, body.room, ctx.config.bureauSecret) };
    ctx.db.setRoomState(body.operativeId, body.room, "forced", true);
    if (body.room === "room1" && ctx.db.getOperative(body.operativeId)) {
      ctx.db.markRoom1Verified(body.operativeId);
    }
    const event = ctx.events.emit({
      type: "override.completed",
      room: body.room,
      operativeId: body.operativeId,
      message: `${body.operativeId}: ${body.room} force-completed by marshal.`,
      data: unlock,
    });
    return c.json({ ok: true, ...unlock, event });
  });

  app.post("/rooms/:room/complete", (c) => {
    const room = c.req.param("room");
    if (!ROOMS.has(room)) return c.json({ error: "invalid room" }, 400);
    ctx.db.markRoomComplete(room);
    ctx.events.emit({
      type: "room.completed",
      room,
      message: `${room} marked complete; show advances.`,
    });
    return c.json({ ok: true, room });
  });

  app.get("/locks", (c) => c.json({
    pool: operativePool,
    locks: lockAssignments(ctx.config.bureauSecret, operativePool),
  }));

  app.get("/state", (c) => {
    const events = ctx.db.recentEvents(100).map((event) => {
      let data: unknown = event.data;
      try { data = JSON.parse(event.data) as unknown; } catch { /* preserve raw data */ }
      return { ...event, data };
    });
    return c.json({
      operatives: ctx.db.listOperatives(),
      reveals: ctx.db.listReveals(),
      roomState: parsedRoomState(ctx),
      roomsComplete: ctx.db.listCompletedRooms(),
      locks: lockAssignments(ctx.config.bureauSecret, operativePool),
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

  app.get("/health", (c) => c.json({ ok: true, service: "bureau-api", ts: new Date().toISOString() }));

  app.onError((error, c) => {
    console.error("[admin]", error);
    return c.json({ error: "Bureau administration failed" }, 500);
  });
  return app;
}
