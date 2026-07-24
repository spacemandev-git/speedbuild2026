import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import type { AppContext } from "../src/context.ts";
import {
  decodeXPaymentHeader,
  recordTrapSettlement,
  SVM_NETWORK,
} from "../src/facilitator.ts";

describe("x402 payment header", () => {
  test("decodes the v2 X-PAYMENT envelope", () => {
    const accepted = {
      scheme: "exact",
      network: SVM_NETWORK,
      amount: "2500",
      asset: Keypair.generate().publicKey.toBase58(),
      payTo: Keypair.generate().publicKey.toBase58(),
      maxTimeoutSeconds: 120,
      extra: { feePayer: Keypair.generate().publicKey.toBase58() },
    };
    const encoded = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepted,
      payload: { transaction: "partially-signed-base64" },
    })).toString("base64");

    expect(decodeXPaymentHeader(encoded)).toEqual({
      x402Version: 2,
      accepted,
      payload: { transaction: "partially-signed-base64" },
    });
  });

  test("rejects malformed and legacy envelopes", () => {
    expect(() => decodeXPaymentHeader("not-json"))
      .toThrow("base64-encoded JSON");
    const legacy = Buffer.from(JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: "solana-devnet",
      payload: {},
    })).toString("base64");
    expect(() => decodeXPaymentHeader(legacy)).toThrow("x402 v2");
  });
});

describe("FAC-A accounting", () => {
  test("flags the operative found by settled payer pubkey", () => {
    const payer = Keypair.generate().publicKey.toBase58();
    const writes: unknown[][] = [];
    const emitted: unknown[] = [];
    const ctx = {
      db: {
        listOperatives: () => [{ operative_id: "OPERATIVE-11", pubkey: payer }],
        setRoomState: (...args: unknown[]) => { writes.push(args); },
      },
      events: { emit: (event: unknown) => { emitted.push(event); } },
    } as unknown as AppContext;

    expect(recordTrapSettlement(ctx, payer)).toBe("OPERATIVE-11");
    expect(writes).toEqual([["OPERATIVE-11", "room3", "paid_via_trap", "1"]]);
    expect(emitted).toEqual([expect.objectContaining({
      type: "room3.trap-settled",
      room: "room3",
      operativeId: "OPERATIVE-11",
    })]);
  });

  test("still emits when no operative matches", () => {
    let writes = 0;
    let operativeId: unknown = "unset";
    const ctx = {
      db: {
        listOperatives: () => [],
        setRoomState: () => { writes += 1; },
      },
      events: {
        emit: (event: { operativeId?: unknown }) => { operativeId = event.operativeId; },
      },
    } as unknown as AppContext;

    expect(recordTrapSettlement(ctx, Keypair.generate().publicKey.toBase58())).toBeNull();
    expect(writes).toBe(0);
    expect(operativeId).toBeNull();
  });
});
