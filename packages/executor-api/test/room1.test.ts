import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { deriveRoom1Requirements, evaluateRoom1Transaction } from "../src/room1.ts";

const memoProgram = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function transaction(claimant: string, tribute: string, amount: bigint, memo: string): unknown {
  return {
    transaction: {
      message: {
        accountKeys: [{ pubkey: claimant, signer: true }],
        instructions: [
          {
            program: "spl-token",
            parsed: { type: "transferChecked", info: {
              authority: claimant,
              destination: tribute,
              tokenAmount: { amount: amount.toString() },
            } },
          },
          { programId: memoProgram, parsed: memo },
        ],
      },
    },
    meta: { innerInstructions: [] },
  };
}

describe("Room 1 derivation and verification", () => {
  test("derives amount and memo using bigint and LE nonce bytes", () => {
    expect(deriveRoom1Requirements("CLAIMANT-07", 9_001n)).toEqual({
      amount: 1_001n,
      memo: "67a3fafa21ed79b2",
    });
  });

  test("accepts only the exact claimant-signed transfer and memo", () => {
    const claimant = Keypair.generate().publicKey.toBase58();
    const tribute = Keypair.generate().publicKey.toBase58();
    const requirements = deriveRoom1Requirements("CLAIMANT-07", 42n);
    expect(evaluateRoom1Transaction(
      transaction(claimant, tribute, requirements.amount, requirements.memo),
      claimant,
      tribute,
      requirements,
    ).matched).toBe(true);
  });

  test("classifies wrong amount or memo to the right ATA as a near miss", () => {
    const claimant = Keypair.generate().publicKey.toBase58();
    const tribute = Keypair.generate().publicKey.toBase58();
    const requirements = deriveRoom1Requirements("CLAIMANT-07", 42n);
    const result = evaluateRoom1Transaction(
      transaction(claimant, tribute, requirements.amount + 1n, "wrong"),
      claimant,
      tribute,
      requirements,
    );
    expect(result.matched).toBe(false);
    expect(result.nearMiss).toBe(true);
    expect(result.diagnostics.amountMatches).toBe(false);
    expect(result.diagnostics.memoMatches).toBe(false);
  });
});
