import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { BureauChain } from "../src/chain.ts";
import { createAdminApp, createAdminAuthMiddleware } from "../src/admin.ts";
import { fourDigit } from "../src/combos.ts";
import type { AppContext } from "../src/context.ts";
import { BureauDatabase } from "../src/db.ts";
import { EventHub } from "../src/events.ts";

describe("admin bearer authentication", () => {
  const app = new Hono();
  app.use("*", createAdminAuthMiddleware("test-admin-token"));
  app.get("/health", (c) => c.json({ ok: true }));

  test("rejects missing and incorrect tokens", async () => {
    expect((await app.request("/health")).status).toBe(401);
    expect((await app.request("/health", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
  });

  test("accepts the configured bearer token", async () => {
    const response = await app.request("/health", {
      headers: { Authorization: "Bearer test-admin-token" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

const databases: BureauDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture(): { app: ReturnType<typeof createAdminApp>; ctx: AppContext } {
  const db = new BureauDatabase(":memory:");
  databases.push(db);
  const ctx: AppContext = {
    config: {
      bureauSecret: "fixed-test-secret",
      adminToken: "test-admin-token",
      operativePool: 24,
      rpcUrl: "http://127.0.0.1:8899",
      wsUrl: "ws://127.0.0.1:8900",
      bureauDeployerPath: "unused",
      credMintPath: "unused",
      dbPath: ":memory:",
      idlPath: "unused",
      deployDir: "unused",
      operativeRegistryPath: "unused",
      ports: { public: 8700, facilitator: 8701, trapFacilitator: 8702, room5: 8703, admin: 8710 },
    },
    db,
    events: new EventHub(db),
    chain: {} as BureauChain,
  };
  return { app: createAdminApp(ctx), ctx };
}

const auth = {
  Authorization: "Bearer test-admin-token",
  "Content-Type": "application/json",
};

async function post(app: ReturnType<typeof createAdminApp>, path: string, body: unknown): Promise<Response> {
  return await app.request(path, { method: "POST", headers: auth, body: JSON.stringify(body) });
}

describe("admin operational controls", () => {
  test("lists deterministic lock assignments and requires authentication", async () => {
    const { app } = fixture();
    expect((await app.request("/locks")).status).toBe(401);
    const response = await app.request("/locks", { headers: auth });
    expect(response.status).toBe(200);
    const body = await response.json() as { pool: number; locks: Array<Record<string, unknown>> };
    expect(body.pool).toBe(24);
    expect(body.locks).toHaveLength(8);
    expect(body.locks[0]).toEqual({
      room: "room1",
      lock: 1,
      members: ["OPERATIVE-01", "OPERATIVE-02", "OPERATIVE-03", "OPERATIVE-04"],
      liveOperative: expect.any(String),
      liveCode: expect.stringMatching(/^\d{4}$/),
    });
  });

  test("grants an override to an unregistered well-formed operative", async () => {
    const { app } = fixture();
    const response = await post(app, "/override", { operativeId: "RESERVE-16", room: "room3" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      fragment: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{12}$/),
      event: { type: "override.granted", operativeId: "RESERVE-16", room: "room3" },
    });
  });

  test("force-completes an operative room with the deterministic combo", async () => {
    const { app, ctx } = fixture();
    const operativeId = "OPERATIVE-07";
    const response = await post(app, "/force-complete", { operativeId, room: "room2" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      combo: fourDigit(operativeId, "room2", ctx.config.bureauSecret),
      event: { type: "override.completed", operativeId, room: "room2" },
    });
    expect(ctx.db.getRoomState(operativeId, "room2", "forced")).toBe("true");
  });

  test("marks a room complete and exposes it in state", async () => {
    const { app } = fixture();
    const completed = await post(app, "/rooms/room2/complete", {});
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({ ok: true, room: "room2" });
    const state = await app.request("/state", { headers: auth });
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ roomsComplete: ["room2"] });
  });

  test("rejects invalid rooms and operative IDs", async () => {
    const { app } = fixture();
    expect((await post(app, "/override", { operativeId: "invalid id", room: "room1" })).status).toBe(400);
    expect((await post(app, "/force-complete", { operativeId: "OPERATIVE-07", room: "room6" })).status).toBe(400);
    expect((await post(app, "/rooms/room6/complete", {})).status).toBe(400);
  });
});
