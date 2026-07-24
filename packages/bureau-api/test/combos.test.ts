import { describe, expect, test } from "bun:test";
import {
  flashSeconds,
  fourDigit,
  fragment,
  hmac,
  lockAssignments,
  operativeId,
} from "../src/combos.ts";

describe("deterministic unlocks", () => {
  const secret = "fixed-test-secret";

  test("fixed HMAC, four-digit, and fragment vectors", () => {
    expect(hmac(secret, "OPERATIVE-07", "room1").toString("hex"))
      .toBe("0e00188eb1f216a9bce9ebb65bd4f1d238589782568eb21c6d9ba3b03afea381");
    expect(fourDigit("OPERATIVE-07", "room1", secret)).toBe("7310");
    expect(fragment("OPERATIVE-07", "room3", 12, secret)).toBe("GVTb6XSxXgbw");
  });

  test("production-style hexadecimal secrets are decoded to key bytes", () => {
    const hexSecret = "00112233445566778899aabbccddeeff";
    expect(hmac(hexSecret, "OPERATIVE-01", "room1").toString("hex"))
      .toBe("6274bdeca1054241ee1ea7c9c20c78cdb13368eb0e8b462b56f32a40ef2a521c");
    expect(fourDigit("OPERATIVE-01", "room1", hexSecret)).toBe("7964");
    expect(fragment("OPERATIVE-01", "room3", 10, hexSecret)).toBe("GzHNGdFpgc");
  });

  test("flash duration is clamped", () => {
    expect(flashSeconds(-20)).toBe(3);
    expect(flashSeconds(0)).toBe(3);
    expect(flashSeconds(4)).toBe(7);
    expect(flashSeconds(7)).toBe(10);
    expect(flashSeconds(99)).toBe(10);
  });

  test("formats operative IDs and rejects numbers outside the pool range", () => {
    expect(operativeId(1)).toBe("OPERATIVE-01");
    expect(operativeId(9)).toBe("OPERATIVE-09");
    expect(operativeId(10)).toBe("OPERATIVE-10");
    expect(operativeId(99)).toBe("OPERATIVE-99");
    expect(() => operativeId(0)).toThrow(RangeError);
    expect(() => operativeId(100)).toThrow(RangeError);
    expect(() => operativeId(1.5)).toThrow(RangeError);
  });

  test("assigns deterministic live members and codes to room locks", () => {
    const locks = lockAssignments(secret, 24);
    expect(locks).toHaveLength(8);
    expect(locks.map(({ room, lock }) => [room, lock])).toEqual([
      ["room1", 1], ["room1", 2], ["room1", 3], ["room1", 4],
      ["room2", 1], ["room2", 2], ["room2", 3], ["room2", 4],
    ]);
    expect(locks.filter(({ room }) => room === "room1").map(({ members }) => members)).toEqual([
      ["OPERATIVE-01", "OPERATIVE-02", "OPERATIVE-03", "OPERATIVE-04"],
      ["OPERATIVE-05", "OPERATIVE-06", "OPERATIVE-07", "OPERATIVE-08"],
      ["OPERATIVE-09", "OPERATIVE-10", "OPERATIVE-11", "OPERATIVE-12"],
      ["OPERATIVE-13", "OPERATIVE-14", "OPERATIVE-15", "OPERATIVE-16"],
    ]);
    expect(locks.filter(({ room }) => room === "room2").map(({ members }) => members)).toEqual([
      ["OPERATIVE-01", "OPERATIVE-02", "OPERATIVE-03"],
      ["OPERATIVE-04", "OPERATIVE-05", "OPERATIVE-06"],
      ["OPERATIVE-07", "OPERATIVE-08", "OPERATIVE-09"],
      ["OPERATIVE-10", "OPERATIVE-11", "OPERATIVE-12"],
    ]);
    expect(locks.map(({ liveOperative }) => liveOperative)).toEqual([
      "OPERATIVE-01", "OPERATIVE-05", "OPERATIVE-10", "OPERATIVE-15",
      "OPERATIVE-03", "OPERATIVE-06", "OPERATIVE-09", "OPERATIVE-11",
    ]);
    expect(lockAssignments(secret, 24)).toEqual(locks);
    for (const lock of locks) {
      expect(lock.members).toContain(lock.liveOperative);
      expect(lock.liveCode).toBe(fourDigit(lock.liveOperative, lock.room, secret));
    }
  });

  test("requires a pool large enough for all room 1 lock members", () => {
    expect(() => lockAssignments(secret, 15)).toThrow(RangeError);
  });
});
