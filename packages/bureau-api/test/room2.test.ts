import { afterEach, describe, expect, test } from "bun:test";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import type { PaymentRequirements } from "@x402/core/types";
import { BureauChain } from "../src/chain.ts";
import type { BureauConfig } from "../src/config.ts";
import type { AppContext } from "../src/context.ts";
import { BureauDatabase } from "../src/db.ts";
import { EventHub } from "../src/events.ts";
import { SVM_NETWORK, type SettledPayment } from "../src/facilitator.ts";
import {
  createRoom2App,
  room2HopBAmount,
  room2Nonces,
  room2VaultOwner,
  type Room2Resources,
} from "../src/room2.ts";

const databases: BureauDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function context(secret = "bureau-secret"): AppContext {
  const config: BureauConfig = {
    bureauSecret: secret,
    adminToken: "admin",
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    bureauDeployerPath: "/unused/deployer.json",
    credMintPath: "/unused/mint.json",
    dbPath: ":memory:",
    idlPath: "/unused/idl.json",
    deployDir: "/unused/deploy",
    operativeRegistryPath: "/unused/operatives.json",
    ports: { public: 8700, facilitator: 8701, trapFacilitator: 8702, room5: 8703, admin: 8710 },
  };
  const db = new BureauDatabase(":memory:");
  databases.push(db);
  return { config, db, events: new EventHub(db), chain: new BureauChain(config) };
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
    expect(room2Nonces("bureau-secret", "OPERATIVE-07")).toEqual({
      nonceA: "197c5c8317d346ec",
      nonceB: "6df36ae2d3ca4f2e",
    });
    expect(room2Nonces("bureau-secret", "OPERATIVE-08").nonceA)
      .not.toBe("197c5c8317d346ec");
  });

  test("computes Hop B amount entirely with bigint", () => {
    expect(room2HopBAmount("6df36ae2d3ca4f2e")).toBe(8_702n);
    expect(room2HopBAmount("ffffffffffffffff")).toBe(7_615n);
    expect(() => room2HopBAmount("not-hex")).toThrow("16 hexadecimal");
  });
});

describe("Room 2 Hop A", () => {
  test("branches SEALED versus PAID using the settlement inspector", async () => {
    const ctx = context();
    const operativeId = "OPERATIVE-07";
    ctx.db.reveal(operativeId, "room2");
    const mint = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const resources: Room2Resources = {
      mint: mint.toBase58(),
      feePayer: Keypair.generate().publicKey.toBase58(),
      componentOwner: owner.toBase58(),
      componentAta: getAssociatedTokenAddressSync(mint, owner).toBase58(),
    };
    const { nonceA } = room2Nonces(ctx.config.bureauSecret, operativeId);
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

    const sealed = await room.request(`/component/${operativeId}`, {
      headers: { "X-PAYMENT": header(accepted) },
    });
    expect(sealed.status).toBe(200);
    expect(await sealed.json()).toMatchObject({ status: "SEALED" });
    expect(ctx.db.listRoomState()).toHaveLength(0);
    expect(ctx.db.recentEvents().map((event) => event.type)).toContain("room2.fee-kept");

    inspectedMemo = nonceA;
    const paid = await room.request(`/component/${operativeId}`, {
      headers: { "X-PAYMENT": header(accepted) },
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ status: "FEE ACCEPTED. AUTHORIZATION PENDING." });
    expect(settlements).toBe(2);
    expect(JSON.parse(ctx.db.listRoomState()[0]?.value ?? "null")).toBe("PAID");
    expect(ctx.db.recentEvents().map((event) => event.type)).toContain("room2.hopA");
  });
});

describe("Room 2 completion", () => {
  test("marks the room verified only after both hops are PAID", async () => {
    const ctx = context();
    const operativeId = "OPERATIVE-07";
    ctx.db.reveal(operativeId, "room2");
    const mint = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const resources: Room2Resources = {
      mint: mint.toBase58(),
      feePayer: Keypair.generate().publicKey.toBase58(),
      componentOwner: owner.toBase58(),
      componentAta: getAssociatedTokenAddressSync(mint, owner).toBase58(),
    };
    const { nonceA, nonceB } = room2Nonces(ctx.config.bureauSecret, operativeId);
    const vaultOwner = room2VaultOwner(ctx.config.bureauSecret, operativeId);
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultOwner).toBase58();
    const hopBAmount = room2HopBAmount(nonceB);
    let hop: "A" | "B" = "A";
    const settle = async (): Promise<SettledPayment> => ({
      signature: `signature-hop${hop}`,
      payerPubkey: Keypair.generate().publicKey.toBase58(),
      amount: hop === "A" ? 2_500n : hopBAmount,
      destination: hop === "A" ? resources.componentAta : vaultAta,
      memo: hop === "A" ? nonceA : null,
    });
    const room = createRoom2App(ctx, {
      loadResources: async () => resources,
      settle,
      ensureVaultTokenAccount: async () => {},
    });

    const hopA = await room.request(`/component/${operativeId}`, {
      headers: {
        "X-PAYMENT": header({
          scheme: "exact",
          network: SVM_NETWORK,
          amount: "2500",
          asset: resources.mint,
          payTo: resources.componentOwner,
          maxTimeoutSeconds: 120,
          extra: { feePayer: resources.feePayer, memoRequired: nonceA, exact: true },
        }),
      },
    });
    expect(hopA.status).toBe(200);
    expect(JSON.parse(ctx.db.getRoomState(operativeId, "room2", "hopA") ?? "null")).toBe("PAID");
    expect(ctx.db.getRoomState(operativeId, "room2", "status")).toBeNull();

    hop = "B";
    const hopB = await room.request(`/authorize/${operativeId}`, {
      headers: {
        "X-CARRY": nonceB,
        "X-PAYMENT": header({
          scheme: "exact",
          network: SVM_NETWORK,
          amount: hopBAmount.toString(),
          asset: resources.mint,
          payTo: vaultOwner.toBase58(),
          maxTimeoutSeconds: 120,
          extra: { feePayer: resources.feePayer, amountFormula: "4000 + (nonce_B mod 6000)" },
        }),
      },
    });
    expect(hopB.status).toBe(200);
    expect(await hopB.json()).toMatchObject({ status: "UNSEALED" });
    expect(JSON.parse(ctx.db.getRoomState(operativeId, "room2", "status") ?? "null")).toBe("verified");
  });
});
