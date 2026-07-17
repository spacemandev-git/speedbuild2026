import { Hono } from "hono";
import type { AppContext } from "./context.ts";

const BASE58_CODE = /^[1-9A-HJ-NP-Za-km-z]{8}$/;

function programError(error: unknown): { status: 400; error: string } | null {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/CodeMismatch/i.test(text)) return { status: 400, error: "The deed is not the instrument you claim it to be." };
  if (/DeedStale/i.test(text)) return { status: 400, error: "The deed's crossing window has closed. The Actuary has written it off." };
  if (/DeedAlreadyPresented/i.test(text)) return { status: 400, error: "This deed has already spoken. The registry does not permit an encore." };
  return null;
}

export function createRoom4App(ctx: AppContext): Hono {
  const app = new Hono();

  app.post("/deed/present", async (c) => {
    const body = await c.req.json<{ team?: unknown; code?: unknown }>();
    if (typeof body.team !== "string" || body.team.length < 1 || body.team.length > 16) {
      return c.json({ error: "team must be between 1 and 16 characters" }, 400);
    }
    if (typeof body.code !== "string" || !BASE58_CODE.test(body.code)) {
      return c.json({ error: "code must be exactly 8 base58 characters" }, 400);
    }
    try {
      const signature = await ctx.chain.presentDeed(body.team, body.code);
      let deed = null;
      let statusReadError: string | undefined;
      try {
        deed = await ctx.chain.getDeed(body.team);
      } catch (error) {
        statusReadError = error instanceof Error ? error.message : String(error);
      }
      const message = `${body.team}: deed registered. Title acknowledged. Exposure assessed.`;
      ctx.events.emit({
        type: "room4.presented", room: "room4", message,
        data: { team: body.team, code: body.code, signature, deed, statusReadError },
      });
      ctx.events.emit({
        type: "combo.reveal", room: "room4", message,
        data: { team: body.team, deedCode: body.code },
      });
      return c.json({ ok: true, signature, deed, statusReadError });
    } catch (error) {
      const mapped = programError(error);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw error;
    }
  });

  app.get("/deed/:team/status", async (c) => {
    const team = c.req.param("team");
    if (team.length < 1 || team.length > 16) return c.json({ error: "invalid team" }, 400);
    const deed = await ctx.chain.getDeed(team);
    return deed ? c.json(deed) : c.json({ error: "deed not found" }, 404);
  });

  return app;
}

export async function init(_ctx: AppContext): Promise<void> {
  // Room 4 has no background worker; the far-terminal routes read the chain on demand.
}
