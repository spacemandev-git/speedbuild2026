import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { createAdminApp } from "./admin.ts";
import { BureauChain } from "./chain.ts";
import { createBriefApp } from "./brief.ts";
import { loadConfig, type BureauConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import { BureauDatabase } from "./db.ts";
import { EventHub } from "./events.ts";
import { createHonestFacilitator, createTrapFacilitator } from "./facilitator.ts";
import { Room1Watcher } from "./room1.ts";
import { app as room2App, init as initRoom2 } from "./room2.ts";
import { app as room3App, init as initRoom3 } from "./room3.ts";
import { createRoom4App, init as initRoom4 } from "./room4.ts";
import { app as room5App, init as initRoom5 } from "./room5.ts";

interface Listener {
  port: number;
  name: string;
  server: ReturnType<typeof Bun.serve>;
}

async function openDatabase(config: BureauConfig): Promise<BureauDatabase> {
  try {
    await mkdir(dirname(config.dbPath), { recursive: true });
    return new BureauDatabase(config.dbPath);
  } catch (error) {
    if (process.env.DB_PATH) throw error;
    const fallback = join(tmpdir(), `bureau-api-${process.getuid?.() ?? "local"}-state.sqlite`);
    console.warn(`[startup] cannot open default DB ${config.dbPath}; using ${fallback}: ${error instanceof Error ? error.message : String(error)}`);
    return new BureauDatabase(fallback);
  }
}

function listen(name: string, port: number, app: Hono): Listener {
  try {
    return {
      name,
      port,
      server: Bun.serve({ hostname: "0.0.0.0", port, fetch: app.fetch }),
    };
  } catch (error) {
    throw new Error(`Failed to bind ${name} listener on port ${port}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const db = await openDatabase(config);
  const events = new EventHub(db);
  const chain = new BureauChain(config);
  const ctx: AppContext = { config, db, events, chain };

  const publicApp = new Hono();
  publicApp.route("/", room2App);
  publicApp.route("/", room3App);
  publicApp.route("/", createRoom4App(ctx));
  publicApp.route("/", createBriefApp(ctx));

  await Promise.all([initRoom2(ctx), initRoom3(ctx), initRoom4(ctx), initRoom5(ctx)]);

  const listeners: Listener[] = [];
  try {
    listeners.push(listen("public", config.ports.public, publicApp));
    listeners.push(listen("honest facilitator", config.ports.facilitator, createHonestFacilitator()));
    listeners.push(listen("FAC-A trap facilitator", config.ports.trapFacilitator, createTrapFacilitator()));
    listeners.push(listen("Room 5", config.ports.room5, room5App));
    listeners.push(listen("admin", config.ports.admin, createAdminApp(ctx)));
  } catch (error) {
    for (const listener of listeners) listener.server.stop(true);
    db.close();
    throw error;
  }

  const watcher = new Room1Watcher(db, chain, events, config.bureauSecret);
  watcher.start();
  console.log(`[startup] bureau-api ready: ${listeners.map(({ name, port }) => `${name}=:${port}`).join(", ")}`);
  console.log(`[startup] RPC=${config.rpcUrl} WS=${config.wsUrl} DB=${config.dbPath}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received`);
    await watcher.stop();
    for (const listener of listeners) listener.server.stop(true);
    db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
}
