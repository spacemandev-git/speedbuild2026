import { afterEach, describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { createClauseApp } from "../src/clause.ts";
import type { AppContext } from "../src/context.ts";
import { EstateDatabase } from "../src/db.ts";
import { EventHub } from "../src/events.ts";

const databases: EstateDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture(chainAvailable = true): { ctx: AppContext; mintReads: { count: number } } {
  const db = new EstateDatabase(":memory:");
  databases.push(db);
  const claimant = Keypair.generate().publicKey.toBase58();
  db.upsertClaimant("C-1", claimant, "17");
  const mint = Keypair.generate().publicKey;
  const program = Keypair.generate().publicKey;
  const mintReads = { count: 0 };
  const ctx = {
    config: {
      estateSecret: "clause-secret", adminToken: "admin", rpcUrl: "http://private", wsUrl: "ws://private",
      estateDeployerPath: "", scripMintPath: "", dbPath: ":memory:", idlPath: "", deployDir: "", claimantRegistryPath: "",
      ports: { public: 8700, facilitator: 8701, trapFacilitator: 8702, ledger: 8703, admin: 8710 },
    },
    db,
    events: new EventHub(db),
    chain: {
      getScripMint: async () => {
        mintReads.count += 1;
        if (!chainAvailable) throw new Error("mint file absent");
        return mint;
      },
      getProgramId: async () => program,
    },
  } as unknown as AppContext;
  return { ctx, mintReads };
}

describe("public clause disclosure", () => {
  test("checks reveal state before disclosing or loading chain parameters", async () => {
    const { ctx, mintReads } = fixture();
    const app = createClauseApp(ctx);
    const sealed = await app.request("/clause/room1?claim=C-1");
    expect(sealed.status).toBe(404);
    expect(await sealed.json()).toEqual({ error: "that clause remains sealed by order of the executors" });
    expect(mintReads.count).toBe(0);

    ctx.db.reveal("C-1", "room1");
    const opened = await app.request("/clause/room1?claim=C-1");
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual(expect.objectContaining({
      rpcUrl: "http://10.61.0.20:8899",
      wsUrl: "ws://10.61.0.20:8900",
      claimNumber: "C-1",
      programId: expect.any(String),
      scripMint: expect.any(String),
    }));
  });

  test("allows only a generic subset when at least one claimant has the room", async () => {
    const { ctx } = fixture();
    ctx.db.reveal("C-1", "room3");
    const response = await createClauseApp(ctx).request("/clause/room3");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.consoleUrl).toBe("http://10.61.0.20:8700/reconstruct");
    expect(body.fragmentUrl).toBeUndefined();
  });

  test("returns the in-fiction 503 shape when lazy estate parameters are absent", async () => {
    const { ctx } = fixture(false);
    ctx.db.reveal("C-1", "room2");
    const response = await createClauseApp(ctx).request("/clause/room2?claim=C-1");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "the estate is not yet in session" });
  });
});
