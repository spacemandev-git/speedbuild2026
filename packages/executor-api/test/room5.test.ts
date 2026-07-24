import { afterEach, describe, expect, test } from "bun:test";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { flashSeconds } from "../src/combos.ts";
import type { AppContext } from "../src/context.ts";
import { EstateDatabase } from "../src/db.ts";
import { EventHub } from "../src/events.ts";
import { createRoom5App, deriveRoom5Route, type Room5Settler } from "../src/room5.ts";

const databases: EstateDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture(): { ctx: AppContext; settle: Room5Settler; settlements: { count: number }; paymentHeader: string } {
  const db = new EstateDatabase(":memory:");
  databases.push(db);
  db.upsertClaimant("CLAIMANT-07", Keypair.generate().publicKey.toBase58(), "17");
  const mint = Keypair.generate().publicKey;
  const deployer = Keypair.generate();
  const destination = getAssociatedTokenAddressSync(mint, deployer.publicKey).toBase58();
  const paymentHeader = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      amount: "200",
      asset: mint.toBase58(),
      payTo: destination,
      maxTimeoutSeconds: 300,
      extra: { feePayer: deployer.publicKey.toBase58() },
    },
    payload: { transaction: "mock" },
  })).toString("base64");
  const settlements = { count: 0 };
  const settle: Room5Settler = async () => {
    settlements.count += 1;
    return { signature: `sig-${settlements.count}`, payerPubkey: Keypair.generate().publicKey.toBase58(), amount: 200n, destination, memo: null };
  };
  const ctx = {
    config: {
      estateSecret: "estate-secret", adminToken: "admin", rpcUrl: "http://rpc", wsUrl: "ws://ws",
      estateDeployerPath: "", scripMintPath: "", dbPath: ":memory:", idlPath: "", deployDir: "", claimantRegistryPath: "",
      ports: { public: 8700, facilitator: 8701, trapFacilitator: 8702, ledger: 8703, admin: 8710 },
    },
    db,
    events: new EventHub(db),
    chain: { getScripMint: async () => mint, getDeployer: async () => deployer },
  } as unknown as AppContext;
  return { ctx, settle, settlements, paymentHeader };
}

async function paid(app: ReturnType<typeof createRoom5App>, path: string, paymentHeader: string): Promise<Response> {
  return app.request(path, { headers: { "X-PAYMENT": paymentHeader } });
}

describe("Room 5 ledger traversal", () => {
  test("derives stable content addresses", () => {
    const route = deriveRoom5Route("estate-secret", "CLAIMANT-07");
    expect(route.nodes).toEqual(["n_d820", "n_475b", "n_5f11", "n_34f2", "n_268a", "n_fd9f", "n_1b1d"]);
    expect([...route.decoys]).toEqual([[3, "d_048e"], [6, "d_1444"]]);
  });

  test("enforces order, accounts for a decoy, and replays without charging", async () => {
    const { ctx, settle, settlements, paymentHeader } = fixture();
    const app = createRoom5App(ctx, settle);
    const route = deriveRoom5Route(ctx.config.estateSecret, "CLAIMANT-07");
    const query = "?claim=CLAIMANT-07";

    const challenge = await app.request(`/node/start${query}`);
    expect(challenge.status).toBe(402);
    const demand = await challenge.json() as { x402Version: number; accepts: Array<Record<string, unknown>> };
    expect(demand.x402Version).toBe(2);
    expect(demand.accepts[0]).toEqual(expect.objectContaining({
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      amount: "200",
    }));
    expect(demand.accepts[0]?.x402Version).toBeUndefined();

    const wrongTerms = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepted: { ...demand.accepts[0], amount: "201" },
      payload: { transaction: "mock" },
    })).toString("base64");
    expect((await paid(app, `/node/start${query}`, wrongTerms)).status).toBe(402);
    expect(settlements.count).toBe(0);

    expect((await paid(app, `/node/start${query}`, paymentHeader)).status).toBe(200);
    expect(settlements.count).toBe(1);

    const outOfOrder = await paid(app, `/node/${route.nodes[2]}${query}`, paymentHeader);
    expect(outOfOrder.status).toBe(409);
    expect(settlements.count).toBe(1);

    await paid(app, `/node/${route.nodes[1]}${query}`, paymentHeader);
    const decoy = route.decoys.get(3);
    expect(decoy).toBeDefined();
    expect(await (await paid(app, `/node/${decoy}${query}`, paymentHeader)).json()).toEqual({ corrupted: true });
    expect(settlements.count).toBe(3);

    expect(await (await app.request(`/node/${decoy}${query}`)).json()).toEqual({ corrupted: true });
    expect(settlements.count).toBe(3);

    for (let position = 3; position <= 7; position += 1) {
      await paid(app, `/node/${route.nodes[position - 1]}${query}`, paymentHeader);
    }
    expect(settlements.count).toBe(8);

    const replay = await app.request(`/node/${route.nodes[6]}${query}`);
    expect(await replay.json()).toEqual({
      hops_correct: 6,
      flash_seconds: 9,
      token: expect.any(String),
    });
    expect(settlements.count).toBe(8);
    expect(await (await app.request("/scoreboard")).json()).toEqual([
      expect.objectContaining({ claim: "CLAIMANT-07", hops_correct: 6, flash_seconds: 9 }),
    ]);
    expect(ctx.db.recentEvents(20).map((event) => event.type)).toContain("room5.decoy-paid");
    expect(ctx.db.recentEvents(20).map((event) => event.type)).toContain("room5.route-complete");
  });

  test("maps correct hops to bounded mercy flashes", () => {
    expect(flashSeconds(-4)).toBe(3);
    expect(flashSeconds(0)).toBe(3);
    expect(flashSeconds(6)).toBe(9);
    expect(flashSeconds(7)).toBe(10);
    expect(flashSeconds(99)).toBe(10);
  });
});
