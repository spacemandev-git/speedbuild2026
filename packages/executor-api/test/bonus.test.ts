import { afterEach, describe, expect, test } from "bun:test";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { createBonusApp, evaluateMemoPingTransaction, scripBalanceFromParsedAccounts } from "../src/bonus.ts";
import type { AppContext } from "../src/context.ts";
import { EstateDatabase } from "../src/db.ts";
import { EventHub } from "../src/events.ts";

const databases: EstateDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture(): { ctx: AppContext; claim: string } {
  const claim = "CLAIM-7";
  const claimant = Keypair.generate().publicKey;
  const deployer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const claimPda = Keypair.generate().publicKey;
  const destination = getAssociatedTokenAddressSync(mint, deployer.publicKey);
  const db = new EstateDatabase(":memory:");
  databases.push(db);
  db.upsertClaimant(claim, claimant.toBase58(), "987654321");
  db.reveal(claim, "bonus");

  const transferTransaction = {
    transaction: { message: { accountKeys: [{ pubkey: claimant.toBase58(), signer: true }], instructions: [
      { parsed: { type: "transferChecked", info: { authority: claimant.toBase58(), destination: destination.toBase58(), tokenAmount: { amount: "42" } } } },
      { program: "spl-memo", parsed: claim },
    ] } },
    meta: { innerInstructions: [] },
  };
  const memoTransaction = {
    transaction: { message: { accountKeys: [{ pubkey: claimant.toBase58(), signer: true }], instructions: [
      { program: "spl-memo", parsed: `stress:${claim}` },
    ] } },
    meta: { innerInstructions: [] },
  };
  const connection = {
    getSlot: async () => 1_000,
    getParsedTokenAccountsByOwner: async () => ({ value: [
      { account: { data: { parsed: { info: { tokenAmount: { amount: "5" } } } } } },
      { account: { data: { parsed: { info: { tokenAmount: { amount: "7" } } } } } },
    ] }),
    getSignaturesForAddress: async (address: { toBase58(): string }) => {
      if (address.toBase58() === destination.toBase58()) return [{ signature: "tribute-echo", err: null }];
      if (address.toBase58() === claimant.toBase58()) return [{ signature: "memo-ping", err: null }];
      return [];
    },
    getParsedTransaction: async (signature: string) => signature === "tribute-echo" ? transferTransaction : memoTransaction,
  };
  const ctx = {
    config: {
      estateSecret: "secret", adminToken: "admin", rpcUrl: "", wsUrl: "", estateDeployerPath: "", scripMintPath: "",
      dbPath: ":memory:", idlPath: "", deployDir: "", claimantRegistryPath: "",
      ports: { public: 8700, facilitator: 8701, trapFacilitator: 8702, ledger: 8703, admin: 8710 },
    },
    db,
    events: new EventHub(db),
    chain: {
      connection,
      getClaimRecord: async () => ({ address: claimPda.toBase58(), executor: deployer.publicKey.toBase58(), status: 0, probateNonce: 987654321n, tributeAta: destination.toBase58() }),
      claimPda: async () => claimPda,
      getScripMint: async () => mint,
      getDeployer: async () => deployer,
    },
  } as unknown as AppContext;
  return { ctx, claim };
}

async function submit(app: ReturnType<typeof createBonusApp>, path: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("bonus task verification", () => {
  test("accepts only chain-matching reports and discovers transaction tasks", async () => {
    const { ctx, claim } = fixture();
    const app = createBonusApp(ctx);

    expect((await submit(app, "/tasks/decode-nonce", { claim, nonce: "1" })).status).toBe(400);
    expect((await submit(app, "/tasks/decode-nonce", { claim, nonce: "987654321" })).status).toBe(200);
    expect((await submit(app, "/tasks/slot-report", { claim, slot: 1_030 })).status).toBe(200);
    const pda = await ctx.chain.claimPda(claim);
    expect((await submit(app, "/tasks/pda-derive", { claim, address: pda.toBase58() })).status).toBe(200);
    expect((await submit(app, "/tasks/balance-report", { claim, amount: "12" })).status).toBe(200);

    const result = await app.request(`/tasks?claim=${claim}`);
    expect(result.status).toBe(200);
    const body = await result.json() as { completed: number; total: number; completionPercent: number; tasks: Array<{ status: string }> };
    expect(body).toMatchObject({ completed: 6, total: 6, completionPercent: 100 });
    expect(body.tasks.every((task) => task.status === "complete")).toBe(true);
    expect(ctx.db.recentEvents(50).filter((event) => event.type === "bonus.task-complete")).toHaveLength(6);
    expect(ctx.db.recentEvents(50).filter((event) => event.type === "bonus.progress")).toHaveLength(6);
  });

  test("pure transaction and balance evaluators reject unverified shapes", () => {
    const signer = Keypair.generate().publicKey.toBase58();
    const transaction = {
      transaction: { message: { accountKeys: [{ pubkey: signer, signer: true }], instructions: [{ program: "spl-memo", parsed: "stress:C1" }] } },
      meta: { innerInstructions: [] },
    };
    expect(evaluateMemoPingTransaction(transaction, signer, "stress:C1")).toBe(true);
    expect(evaluateMemoPingTransaction(transaction, signer, "stress:C2")).toBe(false);
    expect(evaluateMemoPingTransaction(transaction, Keypair.generate().publicKey.toBase58(), "stress:C1")).toBe(false);
    expect(scripBalanceFromParsedAccounts({ value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: "42" } } } } } }] })).toBe(42n);
  });

  test("keeps an unrevealed stress clause sealed", async () => {
    const { ctx, claim } = fixture();
    ctx.db.sqlite.query("DELETE FROM reveals WHERE claim_number = ? AND room = 'bonus'").run(claim);
    expect((await createBonusApp(ctx).request(`/tasks?claim=${claim}`)).status).toBe(404);
  });
});
