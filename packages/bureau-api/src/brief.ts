import { Hono } from "hono";
import { hmac } from "./combos.ts";
import type { AppContext } from "./context.ts";

const PUBLIC_BASE = "http://10.61.0.20:8700";
const PUBLIC_ROOM5_BASE = "http://10.61.0.20:8703";
const PUBLIC_RPC = "http://10.61.0.20:8899";
const PUBLIC_WS = "ws://10.61.0.20:8900";
const ROOMS = new Set(["room1", "room2", "room3", "room4", "room5"]);

function revealed(ctx: AppContext, room: string, operative?: string): boolean {
  return ctx.db.listReveals().some((row) => row.room === room && (operative === undefined || row.operative_id === operative));
}

export function createBriefApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.get("/brief/:room", async (c) => {
    const room = c.req.param("room");
    const operative = c.req.query("operative");
    if (!ROOMS.has(room)) return c.json({ error: "unknown room" }, 404);
    if (operative !== undefined && (!ctx.db.getOperative(operative) || !revealed(ctx, room, operative))) {
      return c.json({ error: "room not revealed for this operative" }, 404);
    }
    if (operative === undefined && !revealed(ctx, room)) {
      return c.json({ error: "room not revealed for this operative" }, 404);
    }

    try {
      const credMint = (await ctx.chain.getCredMint()).toBase58();
      const common: Record<string, unknown> = {
        rpcUrl: PUBLIC_RPC,
        wsUrl: PUBLIC_WS,
        credMint,
      };

      if (room === "room1") {
        const programId = (await ctx.chain.getProgramId()).toBase58();
        return c.json({ ...common, programId, ...(operative === undefined ? {} : { operativeId: operative }) });
      }
      if (room === "room2") {
        return c.json({ ...common, ...(operative === undefined ? {} : { componentUrl: `${PUBLIC_BASE}/component/${encodeURIComponent(operative)}` }) });
      }
      if (room === "room3") {
        return c.json({
          ...common,
          ...(operative === undefined ? {} : { fragmentUrl: `${PUBLIC_BASE}/fragment/${encodeURIComponent(operative)}` }),
          consoleUrl: `${PUBLIC_BASE}/reconstruct`,
        });
      }
      if (room === "room4") {
        const programId = (await ctx.chain.getProgramId()).toBase58();
        if (operative === undefined) return c.json({ ...common, programId, farTerminalUrl: `${PUBLIC_BASE}/code/present` });
        return c.json({
          ...common,
          programId,
          attemptSalt: hmac(ctx.config.bureauSecret, operative, "room4:salt").toString("hex").slice(0, 8),
          farTerminalUrl: `${PUBLIC_BASE}/code/present`,
        });
      }
      if (room === "room5") {
        if (operative === undefined) return c.json(common);
        return c.json({
          ...common,
          startUrl: `${PUBLIC_ROOM5_BASE}/node/start?operative=${encodeURIComponent(operative)}`,
        });
      }
      return c.json({ error: "unknown room" }, 404);
    } catch {
      return c.json({ error: "service not ready" }, 503);
    }
  });

  return app;
}
