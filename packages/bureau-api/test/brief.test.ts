import { afterEach, describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { createBriefApp } from "../src/brief.ts";
import type { AppContext } from "../src/context.ts";
import { BureauDatabase } from "../src/db.ts";
import { EventHub } from "../src/events.ts";

const databases: BureauDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture(chainAvailable = true): { ctx: AppContext; mintReads: { count: number } } {
  const db = new BureauDatabase(":memory:");
  databases.push(db);
  const operative = Keypair.generate().publicKey.toBase58();
  db.upsertOperative("O-1", operative, "17");
  const mint = Keypair.generate().publicKey;
  const program = Keypair.generate().publicKey;
  const mintReads = { count: 0 };
  const ctx = {
    config: {
      bureauSecret: "brief-secret", adminToken: "admin", rpcUrl: "http://private", wsUrl: "ws://private",
      bureauDeployerPath: "", credMintPath: "", dbPath: ":memory:", idlPath: "", deployDir: "", operativeRegistryPath: "",
      ports: { public: 8700, facilitator: 8701, trapFacilitator: 8702, room5: 8703, admin: 8710 },
    },
    db,
    events: new EventHub(db),
    chain: {
      getCredMint: async () => {
        mintReads.count += 1;
        if (!chainAvailable) throw new Error("mint file absent");
        return mint;
      },
      getProgramId: async () => program,
    },
  } as unknown as AppContext;
  return { ctx, mintReads };
}

describe("public brief disclosure", () => {
  test("checks reveal state before disclosing or loading chain parameters", async () => {
    const { ctx, mintReads } = fixture();
    const app = createBriefApp(ctx);
    const sealed = await app.request("/brief/room1?operative=O-1");
    expect(sealed.status).toBe(404);
    expect(await sealed.json()).toEqual({ error: "room not revealed for this operative" });
    expect(mintReads.count).toBe(0);

    ctx.db.reveal("O-1", "room1");
    const opened = await app.request("/brief/room1?operative=O-1");
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual(expect.objectContaining({
      rpcUrl: "http://10.61.0.20:8899",
      wsUrl: "ws://10.61.0.20:8900",
      operativeId: "O-1",
      programId: expect.any(String),
      credMint: expect.any(String),
    }));
  });

  test("allows only a generic subset when at least one operative has the room", async () => {
    const { ctx } = fixture();
    ctx.db.reveal("C-1", "room3");
    const response = await createBriefApp(ctx).request("/brief/room3");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.consoleUrl).toBe("http://10.61.0.20:8700/reconstruct");
    expect(body.fragmentUrl).toBeUndefined();
  });

  test("returns the neutral 503 shape when lazy Bureau parameters are absent", async () => {
    const { ctx } = fixture(false);
    ctx.db.reveal("O-1", "room2");
    const response = await createBriefApp(ctx).request("/brief/room2?operative=O-1");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service not ready" });
  });

  test("Room 5 brief exposes an operative start URL", async () => {
    const { ctx } = fixture();
    const operative = Keypair.generate().publicKey.toBase58();
    ctx.db.upsertOperative("OPERATIVE-03", operative, "18");
    ctx.db.reveal("OPERATIVE-03", "room5");
    const response = await createBriefApp(ctx).request("/brief/room5?operative=OPERATIVE-03");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      startUrl: "http://10.61.0.20:8703/node/start?operative=OPERATIVE-03",
    }));
    expect(body).not.toHaveProperty("teamName");
  });
});
