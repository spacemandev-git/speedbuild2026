import { Hono } from "hono";
import type { AppContext } from "./context.ts";

const BASE58_CODE = /^[1-9A-HJ-NP-Za-km-z]{8}$/;

function programError(error: unknown): { status: 400; error: string } | null {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/CodeMismatch/i.test(text)) return { status: 400, error: "clearance code mismatch" };
  if (/CodeStale/i.test(text)) return { status: 400, error: "clearance code window has closed" };
  if (/CodeAlreadyPresented/i.test(text)) return { status: 400, error: "clearance code already presented" };
  return null;
}

export function createRoom4App(ctx: AppContext): Hono {
  const app = new Hono();

  app.post("/code/present", async (c) => {
    const body = await c.req.json<{ operative?: unknown; code?: unknown }>();
    if (typeof body.operative !== "string" || body.operative.length < 1 || body.operative.length > 16) {
      return c.json({ error: "operative must be between 1 and 16 characters" }, 400);
    }
    if (typeof body.code !== "string" || !BASE58_CODE.test(body.code)) {
      return c.json({ error: "code must be exactly 8 base58 characters" }, 400);
    }
    try {
      const signature = await ctx.chain.presentCode(body.operative, body.code);
      let clearanceRecord = null;
      let statusReadError: string | undefined;
      try {
        clearanceRecord = await ctx.chain.getClearanceRecord(body.operative);
      } catch (error) {
        statusReadError = error instanceof Error ? error.message : String(error);
      }
      const message = `${body.operative}: CROSSING CONFIRMED`;
      // A confirmed crossing is the room's only solve condition.
      ctx.db.markRoomVerified(body.operative, "room4");
      ctx.events.emit({
        type: "room4.presented", room: "room4", operativeId: body.operative, message,
        data: { operativeId: body.operative, code: body.code, signature, clearanceRecord, statusReadError },
      });
      ctx.events.emit({
        type: "combo.reveal", room: "room4", operativeId: body.operative, message,
        data: { operativeId: body.operative, clearanceCode: body.code },
      });
      return c.json({ ok: true, signature, clearanceRecord, statusReadError });
    } catch (error) {
      const mapped = programError(error);
      if (mapped) return c.json({ error: mapped.error }, mapped.status);
      throw error;
    }
  });

  app.get("/code/:operative/status", async (c) => {
    const operativeId = c.req.param("operative");
    if (operativeId.length < 1 || operativeId.length > 16) return c.json({ error: "invalid operative id" }, 400);
    const clearanceRecord = await ctx.chain.getClearanceRecord(operativeId);
    return clearanceRecord ? c.json(clearanceRecord) : c.json({ error: "clearance record not found" }, 404);
  });

  return app;
}

export async function init(_ctx: AppContext): Promise<void> {
  // Room 4 has no background worker; the far-terminal routes read the chain on demand.
}
