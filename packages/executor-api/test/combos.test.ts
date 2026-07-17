import { describe, expect, test } from "bun:test";
import { flashSeconds, fourDigit, fragment, hmac } from "../src/combos.ts";

describe("deterministic unlocks", () => {
  const secret = "fixed-test-secret";

  test("fixed HMAC, four-digit, and fragment vectors", () => {
    expect(hmac(secret, "CLAIMANT-07", "room1").toString("hex"))
      .toBe("1426bb4a95760464097c715e829780d7e63c88b9cb4b856776d0cb9dbce179ed");
    expect(fourDigit("CLAIMANT-07", "room1", secret)).toBe("2634");
    expect(fragment("CLAIMANT-07", "room3", 12, secret)).toBe("GhyoABRPoVMT");
  });

  test("production-style hexadecimal secrets are decoded to key bytes", () => {
    const hexSecret = "00112233445566778899aabbccddeeff";
    expect(hmac(hexSecret, "CLAIMANT-01", "room1").toString("hex"))
      .toBe("a147068a06ca8dcb9601ae2db6f0dfba85343102a1f6f19d1b1448f1617ee5d5");
    expect(fourDigit("CLAIMANT-01", "room1", hexSecret)).toBe("6506");
    expect(fragment("CLAIMANT-01", "room3", 10, hexSecret)).toBe("4i4zrNzCg6");
  });

  test("flash duration is clamped", () => {
    expect(flashSeconds(-20)).toBe(3);
    expect(flashSeconds(0)).toBe(3);
    expect(flashSeconds(4)).toBe(7);
    expect(flashSeconds(7)).toBe(10);
    expect(flashSeconds(99)).toBe(10);
  });
});
