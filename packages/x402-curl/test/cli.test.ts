import { describe, expect, test } from "bun:test";
import type { PaymentRequirements } from "@x402/core/types";
import { parseArgs, parseHeaderLine, selectRequirement } from "../src/index.ts";

const ENV = {
  HOME: "/home/operative",
  SOLANA_KEYPAIR: undefined,
  SB_RPC_URL: undefined,
};

function requirement(amount = "200"): PaymentRequirements {
  return {
    scheme: "exact",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    amount,
    asset: "mint",
    payTo: "recipient",
    maxTimeoutSeconds: 300,
    extra: { feePayer: "facilitator" },
  };
}

describe("parseArgs", () => {
  test("uses the participant defaults", () => {
    expect(parseArgs(["http://example.test"], ENV)).toEqual({
      keypairPath: "/home/operative/.config/solana/id.json",
      rpcUrl: "http://10.61.0.20:8899",
      headers: [],
      maxAmount: 10000n,
      verbose: false,
      help: false,
      url: "http://example.test",
    });
  });

  test("uses environment defaults", () => {
    const options = parseArgs(["http://example.test"], {
      HOME: "/ignored",
      SOLANA_KEYPAIR: "/keys/operative.json",
      SB_RPC_URL: "http://surfpool.test",
    });
    expect(options.keypairPath).toBe("/keys/operative.json");
    expect(options.rpcUrl).toBe("http://surfpool.test");
  });

  test("parses every request flag and repeated headers", () => {
    const options = parseArgs([
      "--keypair", "/tmp/id.json",
      "--rpc", "http://localhost:8899",
      "-H", "Accept: application/json",
      "--header", "X-Trace: yes",
      "--max-amount", "250",
      "--verbose",
      "http://example.test/node",
    ], ENV);
    expect(options).toEqual({
      keypairPath: "/tmp/id.json",
      rpcUrl: "http://localhost:8899",
      headers: [
        { name: "Accept", value: "application/json" },
        { name: "X-Trace", value: "yes" },
      ],
      maxAmount: 250n,
      verbose: true,
      help: false,
      url: "http://example.test/node",
    });
  });

  test("allows either help flag without a URL", () => {
    expect(parseArgs(["-h"], ENV).help).toBe(true);
    expect(parseArgs(["--help"], ENV).help).toBe(true);
  });

  test("accepts the short verbose flag", () => {
    expect(parseArgs(["-v", "http://example.test"], ENV).verbose).toBe(true);
  });

  test("rejects a missing URL", () => {
    expect(() => parseArgs([], ENV)).toThrow("missing URL");
  });

  test("rejects an unknown flag", () => {
    expect(() => parseArgs(["--wat", "http://example.test"], ENV))
      .toThrow("unknown option: --wat");
  });
});

describe("parseHeaderLine", () => {
  test("splits on the first colon", () => {
    expect(parseHeaderLine("Authorization: Bearer a:b")).toEqual({
      name: "Authorization",
      value: "Bearer a:b",
    });
  });

  test("rejects a line without a colon", () => {
    expect(() => parseHeaderLine("Accept")).toThrow("expected Name: value");
  });
});

describe("selectRequirement", () => {
  test("selects the first accepted requirement", () => {
    const first = requirement("200");
    const second = requirement("300");
    expect(selectRequirement({ accepts: [first, second] }, 10000n)).toBe(first);
  });

  test("rejects an amount above the cap", () => {
    expect(() => selectRequirement({ accepts: [requirement("201")] }, 200n))
      .toThrow("refusing payment of 201 base units; maximum is 200");
  });
});
