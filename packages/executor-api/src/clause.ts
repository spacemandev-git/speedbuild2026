import { Hono } from "hono";
import { hmac } from "./combos.ts";
import type { AppContext } from "./context.ts";

const PUBLIC_BASE = "http://10.61.0.20:8700";
const PUBLIC_LEDGER_BASE = "http://10.61.0.20:8703";
const PUBLIC_RPC = "http://10.61.0.20:8899";
const PUBLIC_WS = "ws://10.61.0.20:8900";
const ROOMS = new Set(["room1", "room2", "room3", "room4", "room5", "bonus"]);

function revealed(ctx: AppContext, room: string, claim?: string): boolean {
  return ctx.db.listReveals().some((row) => row.room === room && (claim === undefined || row.claim_number === claim));
}

function stringFromState(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as { team?: unknown; teamName?: unknown; team_name?: unknown };
      const candidate = record.team ?? record.teamName ?? record.team_name;
      return typeof candidate === "string" ? candidate : null;
    }
  } catch { /* ignore malformed optional mapping */ }
  return null;
}

export function claimantTeam(ctx: AppContext, claim: string): string | null {
  const columns = ctx.db.sqlite.query("PRAGMA table_info(claimants)").all() as Array<{ name: string }>;
  for (const column of ["team", "team_name"] as const) {
    if (!columns.some((entry) => entry.name === column)) continue;
    const row = ctx.db.sqlite.query(`SELECT ${column} AS team FROM claimants WHERE claim_number = ?`).get(claim) as { team: string | null } | null;
    if (row?.team) return row.team;
  }
  const row = ctx.db.listRoomState().find((entry) => entry.claim_number === claim
    && ["team", "teamName", "team_name", "claimant_team"].includes(entry.key));
  return row ? stringFromState(row.value) : null;
}

export function createClauseApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.get("/clause/:room", async (c) => {
    const room = c.req.param("room");
    const claim = c.req.query("claim");
    if (!ROOMS.has(room)) return c.json({ error: "the will contains no clause under that name" }, 404);
    if (claim !== undefined && (!ctx.db.getClaimant(claim) || !revealed(ctx, room, claim))) {
      return c.json({ error: "that clause remains sealed by order of the executors" }, 404);
    }
    if (claim === undefined && !revealed(ctx, room)) {
      return c.json({ error: "that clause remains sealed by order of the executors" }, 404);
    }

    try {
      const scripMint = (await ctx.chain.getScripMint()).toBase58();
      const common: Record<string, unknown> = {
        rpcUrl: PUBLIC_RPC,
        wsUrl: PUBLIC_WS,
        scripMint,
      };

      if (room === "room1") {
        const programId = (await ctx.chain.getProgramId()).toBase58();
        return c.json({ ...common, programId, ...(claim === undefined ? {} : { claimNumber: claim }) });
      }
      if (room === "room2") {
        return c.json({ ...common, ...(claim === undefined ? {} : { componentUrl: `${PUBLIC_BASE}/component/${encodeURIComponent(claim)}` }) });
      }
      if (room === "room3") {
        return c.json({
          ...common,
          ...(claim === undefined ? {} : { fragmentUrl: `${PUBLIC_BASE}/fragment/${encodeURIComponent(claim)}` }),
          consoleUrl: `${PUBLIC_BASE}/reconstruct`,
        });
      }
      if (room === "room4") {
        const programId = (await ctx.chain.getProgramId()).toBase58();
        if (claim === undefined) return c.json({ ...common, programId, farTerminalUrl: `${PUBLIC_BASE}/deed/present` });
        const teamName = claimantTeam(ctx, claim);
        const saltSubject = teamName ?? claim;
        return c.json({
          ...common,
          programId,
          teamName,
          attemptSalt: hmac(ctx.config.estateSecret, saltSubject, "room4:salt").toString("hex").slice(0, 8),
          farTerminalUrl: `${PUBLIC_BASE}/deed/present`,
        });
      }
      if (room === "room5") {
        if (claim === undefined) return c.json(common);
        const teamName = claimantTeam(ctx, claim);
        return c.json({
          ...common,
          teamName,
          startUrl: teamName === null ? null : `${PUBLIC_LEDGER_BASE}/node/start?team=${encodeURIComponent(teamName)}`,
        });
      }
      return c.json({
        ...common,
        tasksUrl: claim === undefined ? `${PUBLIC_BASE}/tasks` : `${PUBLIC_BASE}/tasks?claim=${encodeURIComponent(claim)}`,
      });
    } catch {
      return c.json({ error: "the estate is not yet in session" }, 503);
    }
  });

  return app;
}
