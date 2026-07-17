import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import type { EstateChain } from "../src/chain.ts";
import type { ExecutorConfig } from "../src/config.ts";
import type { AppContext } from "../src/context.ts";
import { EstateDatabase } from "../src/db.ts";
import { EventHub } from "../src/events.ts";
import {
  app,
  crc8,
  decodeShareWire,
  encodeShareWire,
  evaluateSelfSettlement,
  init,
  xorWithKeystream,
} from "../src/room3.ts";
import { combine } from "../src/shamir.ts";

const participants = ["CLAIM-01", "CLAIM-02", "CLAIM-03", "CLAIM-04", "CLAIM-05", "CLAIM-06"];
const bought = ["CLAIM-05", "CLAIM-06"];

function combinations<T>(values: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return values.flatMap((value, index) => combinations(values.slice(index + 1), size - 1)
    .map((tail) => [value, ...tail]));
}

function stored<T>(db: EstateDatabase, claimNumber: string, key: string): T {
  const row = db.sqlite.query(
    "SELECT value FROM room_state WHERE claim_number = ? AND room = 'room3' AND key = ?",
  ).get(claimNumber, key) as { value: string } | null;
  if (!row) throw new Error(`missing state ${claimNumber}/${key}`);
  return JSON.parse(row.value) as T;
}

interface TestContext {
  ctx: AppContext;
  db: EstateDatabase;
  transactions: Map<string, unknown>;
}

async function setup(): Promise<TestContext> {
  const db = new EstateDatabase(":memory:");
  const transactions = new Map<string, unknown>();
  const deployer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const chain = {
    getDeployer: async () => deployer,
    getScripMint: async () => mint,
    connection: {
      getParsedTransaction: async (signature: string) => transactions.get(signature) ?? null,
    },
  } as unknown as EstateChain;
  const config: ExecutorConfig = {
    estateSecret: "test-estate-secret",
    adminToken: "test-admin-token",
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    estateDeployerPath: "unused",
    scripMintPath: "unused",
    dbPath: ":memory:",
    idlPath: "unused",
    deployDir: "unused",
    claimantRegistryPath: "unused",
    ports: { public: 8700, facilitator: 8701, trapFacilitator: 8702, ledger: 8703, admin: 8710 },
  };
  const ctx: AppContext = { config, db, events: new EventHub(db), chain };
  for (const claimNumber of participants) {
    db.upsertClaimant(claimNumber, Keypair.generate().publicKey.toBase58(), "1");
  }
  await init(ctx);
  const response = await app.request("/fragment/config", {
    method: "POST",
    headers: { Authorization: "Bearer test-admin-token", "Content-Type": "application/json" },
    body: JSON.stringify({ participants, bought }),
  });
  expect(response.status).toBe(201);
  return { ctx, db, transactions };
}

function settlementTransaction(claimant: string, vaultAta: string, amount = "1500"): unknown {
  return {
    transaction: {
      message: {
        accountKeys: [{ pubkey: claimant, signer: true }],
        instructions: [{
          program: "spl-token",
          parsed: { type: "transferChecked", info: {
            authority: claimant,
            destination: vaultAta,
            tokenAmount: { amount },
          } },
        }],
      },
    },
    meta: { err: null, innerInstructions: [] },
  };
}

describe("Room 3 primitives", () => {
  test("CRC detects mutations while recomputed poison remains locally valid", () => {
    const data = Uint8Array.from({ length: 32 }, (_, index) => index);
    const wire = encodeShareWire(data);
    expect(wire[wire.length - 1]).toBe(crc8(data));
    expect(decodeShareWire(wire)).toEqual(data);
    wire[4] = (wire[4] ?? 0) ^ 1;
    expect(decodeShareWire(wire)).toBeNull();
    wire[wire.length - 1] = crc8(wire.slice(0, -1));
    expect(decodeShareWire(wire)).toEqual(wire.slice(0, -1));
  });

  test("XOR keystream encrypts and decrypts data longer than one hash block", () => {
    const plaintext = Uint8Array.from({ length: 97 }, (_, index) => index * 13 & 0xff);
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const salt = Uint8Array.from({ length: 16 }, (_, index) => 255 - index);
    const encrypted = xorWithKeystream(plaintext, key, salt);
    expect(encrypted).not.toEqual(plaintext);
    expect(xorWithKeystream(encrypted, key, salt)).toEqual(plaintext);
  });

  test("self-settlement requires claimant signature, authority, destination, and exact total", () => {
    const claimant = Keypair.generate().publicKey.toBase58();
    const vaultAta = Keypair.generate().publicKey.toBase58();
    expect(evaluateSelfSettlement(settlementTransaction(claimant, vaultAta), claimant, vaultAta).matched).toBe(true);
    expect(evaluateSelfSettlement(settlementTransaction(claimant, vaultAta, "1499"), claimant, vaultAta).matched).toBe(false);
    expect(evaluateSelfSettlement(settlementTransaction(claimant, Keypair.generate().publicKey.toBase58()), claimant, vaultAta).matched).toBe(false);
    expect(evaluateSelfSettlement(settlementTransaction(claimant, vaultAta), Keypair.generate().publicKey.toBase58(), vaultAta).matched).toBe(false);
  });
});

describe("Room 3 routes and reconstruction", () => {
  test("requires reveal, emits the two-route x402 v2 challenge, and keeps trap serves stable", async () => {
    const { db } = await setup();
    expect((await app.request(`/fragment/${participants[0]}`)).status).toBe(404);
    db.reveal(participants[0] as string, "room3");
    const challenge = await app.request(`/fragment/${participants[0]}`);
    expect(challenge.status).toBe(402);
    const body = await challenge.json() as { x402Version: number; accepts: Array<Record<string, unknown>> };
    expect(body.x402Version).toBe(2);
    expect(body.accepts).toHaveLength(2);
    expect(body.accepts.map((route) => route.amount)).toEqual(["1500", "1500"]);
    expect(body.accepts.map((route) => route.payTo)).toEqual([body.accepts[0]?.payTo, body.accepts[0]?.payTo]);

    const first = await app.request(`/fragment/${participants[0]}`, { headers: { "X-PAYMENT-SETTLED": "trap-signature" } });
    const second = await app.request(`/fragment/${participants[0]}`, { headers: { "X-PAYMENT-SETTLED": "trap-signature" } });
    expect(first.status).toBe(200);
    expect(await second.text()).toBe(await first.clone().text());
    expect(second.headers.get("X-PAYMENT-RESPONSE")).toBe(first.headers.get("X-PAYMENT-RESPONSE"));
    db.close();
  });

  test("self-settlement serves the true share and redeems the signature", async () => {
    const { ctx, db, transactions } = await setup();
    const claimNumber = participants[0] as string;
    db.reveal(claimNumber, "room3");
    const challenge = await app.request(`/fragment/${claimNumber}`);
    const body = await challenge.json() as { accepts: Array<{ payTo: string }> };
    const signature = "self-settlement-signature";
    transactions.set(signature, settlementTransaction(db.getClaimant(claimNumber)?.pubkey ?? "", body.accepts[1]?.payTo ?? ""));
    const response = await app.request(`/fragment/${claimNumber}`, {
      headers: { "X-SETTLEMENT-SIGNATURE": signature },
    });
    expect(response.status).toBe(200);
    const fragmentBody = await response.json() as { encShare: string; salt: string };
    const paymentResponse = JSON.parse(Buffer.from(response.headers.get("X-PAYMENT-RESPONSE") ?? "", "base64").toString()) as { keyMaterial: string };
    const decrypted = xorWithKeystream(
      Buffer.from(fragmentBody.encShare, "hex"),
      Buffer.from(paymentResponse.keyMaterial, "hex"),
      Buffer.from(fragmentBody.salt, "hex"),
    );
    expect(Buffer.from(decrypted).toString("hex")).toBe(stored<string>(db, claimNumber, "true_share"));
    expect(stored<string>(db, "__redeemed__", signature)).toBe(claimNumber);
    expect(ctx.events).toBeDefined();
    db.close();
  });

  test("two CRC-valid poisoned shares leave exactly one valid four-of-six selection", async () => {
    const { db } = await setup();
    const target = stored<string>(db, "__round__", "target_hash");
    let passingSelections = 0;
    for (const selection of combinations(participants, 4)) {
      const shares = selection.map((claimNumber) => {
        const key = bought.includes(claimNumber) ? "poison_share" : "true_share";
        const wire = Buffer.from(stored<string>(db, claimNumber, key), "hex");
        const data = decodeShareWire(wire);
        if (!data) throw new Error("configured wire share failed CRC");
        return { index: stored<number>(db, claimNumber, "share_index"), data };
      });
      const hash = createHash("sha256").update(combine(shares, 4)).digest("hex");
      if (hash === target) passingSelections += 1;
    }
    expect(passingSelections).toBe(1);
    db.close();
  });

  test("rejects bad CRC and enforces the three-attempt limit", async () => {
    const { db } = await setup();
    const selected = [participants[0], participants[1], participants[2], participants[4]] as string[];
    const damaged = Buffer.from(stored<string>(db, selected[0] as string, "true_share"), "hex");
    damaged[0] = (damaged[0] ?? 0) ^ 1;
    const bad = await app.request("/reconstruct/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimNumber: selected[0], shareIndex: 1, share: damaged.toString("hex") }),
    });
    expect(bad.status).toBe(400);

    for (const claimNumber of selected) {
      const key = bought.includes(claimNumber) ? "poison_share" : "true_share";
      const submit = await app.request("/reconstruct/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimNumber,
          shareIndex: stored<number>(db, claimNumber, "share_index"),
          share: stored<string>(db, claimNumber, key),
        }),
      });
      expect(submit.status).toBe(200);
    }

    const request = () => app.request("/reconstruct/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimNumbers: selected }),
    });
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(409);
    expect((await request()).status).toBe(409);
    const state = await (await app.request("/reconstruct/state")).json() as { attemptsLeft: number; history: unknown[] };
    expect(state.attemptsLeft).toBe(0);
    expect(state.history).toHaveLength(3);
    const exhausted = db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE type = 'room3.exhausted'")
      .get() as { count: number };
    expect(exhausted.count).toBe(1);
    db.close();
  });
});
