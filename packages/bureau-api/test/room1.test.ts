import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { deriveRoom1Requirements, evaluateRoom1Transaction } from "../src/room1.ts";

const memoProgram = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function transaction(operative: string, clearance: string, amount: bigint, memo: string): unknown {
  return {
    transaction: {
      message: {
        accountKeys: [{ pubkey: operative, signer: true }],
        instructions: [
          {
            program: "spl-token",
            parsed: { type: "transferChecked", info: {
              authority: operative,
              destination: clearance,
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
    expect(deriveRoom1Requirements("OPERATIVE-07", 9_001n)).toEqual({
      amount: 1_001n,
      memo: "1e7de1dfc8580b20",
    });
  });

  test("accepts only the exact operative-signed transfer and memo", () => {
    const operative = Keypair.generate().publicKey.toBase58();
    const clearance = Keypair.generate().publicKey.toBase58();
    const requirements = deriveRoom1Requirements("OPERATIVE-07", 42n);
    expect(evaluateRoom1Transaction(
      transaction(operative, clearance, requirements.amount, requirements.memo),
      operative,
      clearance,
      requirements,
    ).matched).toBe(true);
  });

  test("classifies wrong amount or memo to the right ATA as a near miss", () => {
    const operative = Keypair.generate().publicKey.toBase58();
    const clearance = Keypair.generate().publicKey.toBase58();
    const requirements = deriveRoom1Requirements("OPERATIVE-07", 42n);
    const result = evaluateRoom1Transaction(
      transaction(operative, clearance, requirements.amount + 1n, "wrong"),
      operative,
      clearance,
      requirements,
    );
    expect(result.matched).toBe(false);
    expect(result.nearMiss).toBe(true);
    expect(result.diagnostics.amountMatches).toBe(false);
    expect(result.diagnostics.memoMatches).toBe(false);
  });
});
