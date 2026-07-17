import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "./config.ts";
import { HOST_AGENT_HOST, HOST_AGENT_PORT, loadConfig } from "./config.ts";
import { IncusClient, IncusError } from "./incus.ts";
import { isRoom, ParticipantError, ParticipantManager } from "./participants.ts";
import { StateStore } from "./state.ts";
import { ZoneMonitor } from "./zones.ts";

interface ErrorBody {
  error: string;
  detail?: string;
}

function secureEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function detailFor(error: unknown): string | undefined {
  if (error instanceof ParticipantError) return error.detail;
  if (error instanceof IncusError) return error.stderr || error.message;
  return error instanceof Error ? error.message : undefined;
}

async function jsonObject(context: Context): Promise<Record<string, unknown>> {
  const raw = await context.req.text();
  if (!raw.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ParticipantError("invalid JSON body", 400);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ParticipantError("JSON body must be an object", 400);
  }
  return value as Record<string, unknown>;
}

export function createApp(config: Config, participants: ParticipantManager, zones: ZoneMonitor): Hono {
  const app = new Hono();

  app.use("*", async (context, next) => {
    const startedAt = performance.now();
    let failed = false;
    try {
      await next();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      console.log(JSON.stringify({
        component: "http",
        method: context.req.method,
        path: context.req.path,
        status: failed ? 500 : context.res.status,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      }));
    }
  });

  app.use("*", async (context, next) => {
    const authorization = context.req.header("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token || !secureEqual(token, config.hostAgentToken)) {
      return context.json<ErrorBody>({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.get("/health", (context) => context.json({ ok: true }));
  app.get("/zones", async (context) => context.json(await zones.getZones()));
  app.get("/participants", async (context) => context.json(await participants.list()));
  app.get("/participants/:name", async (context) => context.json(await participants.get(context.req.param("name"))));

  app.post("/participants", async (context) => {
    const body = await jsonObject(context);
    if (body.name !== undefined && typeof body.name !== "string") {
      throw new ParticipantError("name must be a string", 400);
    }
    if (body.authorizedKey !== undefined && typeof body.authorizedKey !== "string") {
      throw new ParticipantError("authorizedKey must be a string", 400);
    }
    return context.json(
      await participants.provision(body.name as string | undefined, body.authorizedKey as string | undefined),
      201,
    );
  });

  app.post("/participants/:name/reveal", async (context) => {
    const body = await jsonObject(context);
    if (typeof body.room !== "string" || !isRoom(body.room)) {
      throw new ParticipantError("invalid room", 400, "expected room1..room5 or bonus");
    }
    return context.json(await participants.reveal(context.req.param("name"), body.room));
  });

  app.post("/participants/:name/suspend", async (context) => {
    return context.json(await participants.suspend(context.req.param("name")));
  });
  app.post("/participants/:name/resume", async (context) => {
    return context.json(await participants.resume(context.req.param("name")));
  });
  app.post("/participants/:name/reset", async (context) => {
    return context.json(await participants.reset(context.req.param("name")));
  });
  app.delete("/participants/:name", async (context) => {
    return context.json(await participants.remove(context.req.param("name")));
  });

  app.notFound((context) => context.json<ErrorBody>({ error: "not found" }, 404));
  app.onError((error, context) => {
    const status = error instanceof ParticipantError ? error.status : 500;
    const body: ErrorBody = { error: error.message || "internal server error" };
    const detail = detailFor(error);
    if (detail && detail !== body.error) body.detail = detail;
    if (status >= 500) console.error(JSON.stringify({ component: "http", error: body.error, detail }));
    return context.json(body, status as 400 | 404 | 409 | 500);
  });

  return app;
}

export function startServer(config = loadConfig()): Bun.Server<unknown> {
  const incus = new IncusClient();
  const stateStore = new StateStore(config.statePath);
  const participants = new ParticipantManager(config, incus, stateStore);
  const zones = new ZoneMonitor(incus);
  const app = createApp(config, participants, zones);
  const serve = (hostname: string): Bun.Server<unknown> => Bun.serve({
    hostname,
    port: HOST_AGENT_PORT,
    fetch: app.fetch,
  });

  try {
    const server = serve(HOST_AGENT_HOST);
    console.log(`sb-host-agent listening on http://${HOST_AGENT_HOST}:${HOST_AGENT_PORT}`);
    return server;
  } catch (error) {
    console.warn(`warning: could not bind ${HOST_AGENT_HOST}:${HOST_AGENT_PORT}; falling back to 0.0.0.0 (${error instanceof Error ? error.message : String(error)})`);
    const server = serve("0.0.0.0");
    console.log(`sb-host-agent listening on http://0.0.0.0:${HOST_AGENT_PORT}`);
    return server;
  }
}

if (import.meta.main) startServer();
