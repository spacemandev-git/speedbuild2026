import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { decodeClearanceRecord, decodeVerificationRecord } from "../src/chain.ts";

describe("manual account decoders", () => {
  test("decodes VerificationRecord at the documented offsets", () => {
    const verifier = Keypair.generate().publicKey;
    const clearance = Keypair.generate().publicKey;
    const bytes = Buffer.alloc(81, 0);
    Buffer.from(verifier.toBytes()).copy(bytes, 8);
    bytes[40] = 1;
    bytes.writeBigUInt64LE(0x0102_0304_0506_0708n, 41);
    Buffer.from(clearance.toBytes()).copy(bytes, 49);

    expect(decodeVerificationRecord(bytes, "verification-pda")).toEqual({
      address: "verification-pda",
      verifier: verifier.toBase58(),
      status: 1,
      clearanceNonce: 0x0102_0304_0506_0708n,
      clearanceAta: clearance.toBase58(),
    });
  });

  test("decodes the variable-length ClearanceRecord layout", () => {
    const operative = "OPERATIVE-04";
    const bytes = Buffer.alloc(8 + 4 + operative.length + 8 + 8 + 1, 0);
    bytes.writeUInt32LE(operative.length, 8);
    bytes.write(operative, 12, "utf8");
    bytes.write("7Gk9QpZ2", 12 + operative.length, "utf8");
    bytes.writeBigUInt64LE(4_500n, 20 + operative.length);
    bytes[28 + operative.length] = 1;

    expect(decodeClearanceRecord(bytes, "clearance-pda")).toEqual({
      address: "clearance-pda",
      operative,
      clearanceCode: "7Gk9QpZ2",
      issuedSlot: 4_500n,
      presented: true,
    });
  });

  test("rejects truncated data", () => {
    expect(() => decodeVerificationRecord(Buffer.alloc(80))).toThrow("truncated");
    expect(() => decodeClearanceRecord(Buffer.alloc(11))).toThrow("truncated");
  });
});
