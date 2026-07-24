import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "./config.ts";
import { BUREAU_ADMIN_BASE, HOST_AGENT_HOST, HOST_AGENT_PORT, loadConfig } from "./config.ts";
import { IncusClient, IncusError } from "./incus.ts";
import { BureauNotifier } from "./notifier.ts";
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

function archiveResponse(bytes: Uint8Array, filename: string, contentType: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(bytes.byteLength),
    },
  });
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
  app.get("/recordings/archive", async () => {
    const { filename, bytes } = await participants.recordingsArchiveAll();
    return archiveResponse(bytes, filename, "application/x-tar");
  });
  app.get("/participants", async (context) => context.json(await participants.list()));
  app.get("/participants/:name", async (context) => context.json(await participants.get(context.req.param("name"))));
  app.get("/participants/:name/recordings", async (context) =>
    context.json(await participants.recordings(context.req.param("name"))));

  app.get("/participants/:name/recordings/archive", async (context) => {
    const { filename, bytes } = await participants.recordingsArchive(context.req.param("name"));
    return archiveResponse(bytes, filename, "application/gzip");
  });

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
      throw new ParticipantError("invalid room", 400, "expected room1..room5");
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

  let server: Bun.Server<unknown>;
  try {
    server = serve(HOST_AGENT_HOST);
    console.log(`sb-host-agent listening on http://${HOST_AGENT_HOST}:${HOST_AGENT_PORT}`);
  } catch (error) {
    console.warn(`warning: could not bind ${HOST_AGENT_HOST}:${HOST_AGENT_PORT}; falling back to 0.0.0.0 (${error instanceof Error ? error.message : String(error)})`);
    server = serve("0.0.0.0");
    console.log(`sb-host-agent listening on http://0.0.0.0:${HOST_AGENT_PORT}`);
  }

  try {
    const cursorPath = `${config.statePath}.notify-cursor`;
    const notifier = new BureauNotifier({
      eventsUrl: `${BUREAU_ADMIN_BASE}/events`,
      stateUrl: `${BUREAU_ADMIN_BASE}/state`,
      adminToken: config.adminToken,
      incusExec: (container, argv, options) => incus.exec(container, argv, options),
      loadParticipants: async () => (await stateStore.load()).participants,
      readCursor: async () => {
        try {
          const body: unknown = JSON.parse(await readFile(cursorPath, "utf8"));
          if (
            typeof body === "object"
            && body !== null
            && "lastEventId" in body
            && typeof body.lastEventId === "number"
            && Number.isFinite(body.lastEventId)
          ) return body.lastEventId;
          return null;
        } catch (error) {
          if (error instanceof SyntaxError) return null;
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
          throw error;
        }
      },
      writeCursor: async (id) => {
        const temporaryPath = `${cursorPath}.tmp-${process.pid}`;
        await writeFile(temporaryPath, JSON.stringify({ lastEventId: id }), { mode: 0o600 });
        await rename(temporaryPath, cursorPath);
      },
    });
    notifier.start();
  } catch (error) {
    console.warn(JSON.stringify({
      component: "notify",
      warning: "notifier failed to start",
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  return server;
}

if (import.meta.main) startServer();
