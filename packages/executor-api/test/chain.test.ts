import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { decodeClaimRecord, decodeDeed } from "../src/chain.ts";

describe("manual account decoders", () => {
  test("decodes ClaimRecord at the documented offsets", () => {
    const executor = Keypair.generate().publicKey;
    const tribute = Keypair.generate().publicKey;
    const bytes = Buffer.alloc(81, 0);
    Buffer.from(executor.toBytes()).copy(bytes, 8);
    bytes[40] = 1;
    bytes.writeBigUInt64LE(0x0102_0304_0506_0708n, 41);
    Buffer.from(tribute.toBytes()).copy(bytes, 49);

    expect(decodeClaimRecord(bytes, "claim-pda")).toEqual({
      address: "claim-pda",
      executor: executor.toBase58(),
      status: 1,
      probateNonce: 0x0102_0304_0506_0708n,
      tributeAta: tribute.toBase58(),
    });
  });

  test("decodes the variable-length Deed layout", () => {
    const team = "TEAM-ROOK";
    const bytes = Buffer.alloc(8 + 4 + team.length + 8 + 8 + 1, 0);
    bytes.writeUInt32LE(team.length, 8);
    bytes.write(team, 12, "utf8");
    bytes.write("7Gk9QpZ2", 12 + team.length, "utf8");
    bytes.writeBigUInt64LE(4_500n, 20 + team.length);
    bytes[28 + team.length] = 1;

    expect(decodeDeed(bytes, "deed-pda")).toEqual({
      address: "deed-pda",
      team,
      deedCode: "7Gk9QpZ2",
      issuedSlot: 4_500n,
      presented: true,
    });
  });

  test("rejects truncated data", () => {
    expect(() => decodeClaimRecord(Buffer.alloc(80))).toThrow("truncated");
    expect(() => decodeDeed(Buffer.alloc(11))).toThrow("truncated");
  });
});
