import { afterEach, describe, expect, test } from "bun:test";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import type { PaymentRequirements } from "@x402/core/types";
import { EstateChain } from "../src/chain.ts";
import type { ExecutorConfig } from "../src/config.ts";
import type { AppContext } from "../src/context.ts";
import { EstateDatabase } from "../src/db.ts";
import { EventHub } from "../src/events.ts";
import { SVM_NETWORK, type SettledPayment } from "../src/facilitator.ts";
import {
  createRoom2App,
  room2HopBAmount,
  room2Nonces,
  type Room2Resources,
} from "../src/room2.ts";

const databases: EstateDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function context(secret = "estate-secret"): AppContext {
  const config: ExecutorConfig = {
    estateSecret: secret,
    adminToken: "admin",
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    estateDeployerPath: "/unused/deployer.json",
    scripMintPath: "/unused/mint.json",
    dbPath: ":memory:",
    idlPath: "/unused/idl.json",
    deployDir: "/unused/deploy",
    claimantRegistryPath: "/unused/claimants.json",
    ports: { public: 8700, facilitator: 8701, trapFacilitator: 8702, ledger: 8703, admin: 8710 },
  };
  const db = new EstateDatabase(":memory:");
  databases.push(db);
  return { config, db, events: new EventHub(db), chain: new EstateChain(config) };
}

function header(accepted: PaymentRequirements): string {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted,
    payload: { transaction: "mocked" },
  })).toString("base64");
}

describe("Room 2 derivation", () => {
  test("derives stable, domain-separated nonces", () => {
    expect(room2Nonces("estate-secret", "CLAIMANT-07")).toEqual({
      nonceA: "2a6b24d91c3f58ff",
      nonceB: "5dfe8416378332b8",
    });
    expect(room2Nonces("estate-secret", "CLAIMANT-08").nonceA)
      .not.toBe("2a6b24d91c3f58ff");
  });

  test("computes Hop B amount entirely with bigint", () => {
    expect(room2HopBAmount("5dfe8416378332b8")).toBe(4_696n);
    expect(room2HopBAmount("ffffffffffffffff")).toBe(7_615n);
    expect(() => room2HopBAmount("not-hex")).toThrow("16 hexadecimal");
  });
});

describe("Room 2 Hop A", () => {
  test("branches SEALED versus PAID using the settlement inspector", async () => {
    const ctx = context();
    const claimNumber = "CLAIMANT-07";
    ctx.db.reveal(claimNumber, "room2");
    const mint = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const resources: Room2Resources = {
      mint: mint.toBase58(),
      feePayer: Keypair.generate().publicKey.toBase58(),
      componentOwner: owner.toBase58(),
      componentAta: getAssociatedTokenAddressSync(mint, owner).toBase58(),
    };
    const { nonceA } = room2Nonces(ctx.config.estateSecret, claimNumber);
    let inspectedMemo = "the automatic client's unrelated memo";
    let settlements = 0;
    const settle = async (): Promise<SettledPayment> => {
      settlements += 1;
      return {
        signature: `signature-${settlements}`,
        payerPubkey: Keypair.generate().publicKey.toBase58(),
        amount: 2_500n,
        destination: resources.componentAta,
        memo: inspectedMemo,
      };
    };
    const room = createRoom2App(ctx, {
      loadResources: async () => resources,
      settle,
      ensureVaultTokenAccount: async () => {},
    });
    const accepted: PaymentRequirements = {
      scheme: "exact",
      network: SVM_NETWORK,
      amount: "2500",
      asset: resources.mint,
      payTo: resources.componentOwner,
      maxTimeoutSeconds: 120,
      extra: { feePayer: resources.feePayer, memoRequired: nonceA, exact: true },
    };

    const sealed = await room.request(`/component/${claimNumber}`, {
      headers: { "X-PAYMENT": header(accepted) },
    });
    expect(sealed.status).toBe(200);
    expect(await sealed.json()).toMatchObject({ status: "SEALED" });
    expect(ctx.db.listRoomState()).toHaveLength(0);
    expect(ctx.db.recentEvents().map((event) => event.type)).toContain("room2.fee-kept");

    inspectedMemo = nonceA;
    const paid = await room.request(`/component/${claimNumber}`, {
      headers: { "X-PAYMENT": header(accepted) },
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ status: "FEE ACCEPTED. AUTHORIZATION PENDING." });
    expect(settlements).toBe(2);
    expect(JSON.parse(ctx.db.listRoomState()[0]?.value ?? "null")).toBe("PAID");
    expect(ctx.db.recentEvents().map((event) => event.type)).toContain("room2.hopA");
  });
});
