import { describe, expect, test } from "bun:test";
import { combine, split, type Share } from "../src/shamir.ts";

function combinations<T>(values: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return values.flatMap((value, index) => combinations(values.slice(index + 1), size - 1)
    .map((tail) => [value, ...tail]));
}

describe("GF(256) Shamir secret sharing", () => {
  test("round-trips a 32-byte secret", () => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => index * 7 & 0xff);
    const shares = split(secret, 4, 6);
    expect(combine(shares.slice(0, 4), 4)).toEqual(secret);
  });

  test("reconstructs from every four-of-six share selection", () => {
    const secret = new TextEncoder().encode("room-three-secret-is-32-bytes!!");
    const shares = split(secret, 4, 6);
    const selections = combinations(shares, 4);
    expect(selections).toHaveLength(15);
    for (const selection of selections) expect(combine(selection, 4)).toEqual(secret);
  });

  test("a poisoned polynomial point breaks reconstruction", () => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const shares = split(secret, 4, 6);
    const poisoned: Share = { index: shares[0]?.index ?? 1, data: shares[0]?.data.slice() ?? new Uint8Array() };
    poisoned.data[0] = (poisoned.data[0] ?? 0) ^ 0xff;
    expect(combine([poisoned, ...shares.slice(1, 4)], 4)).not.toEqual(secret);
  });

  test("rejects duplicate indices and too few shares", () => {
    const shares = split(new Uint8Array([1, 2, 3]), 2, 3);
    expect(() => combine([shares[0] as Share], 2)).toThrow();
    expect(() => combine([shares[0] as Share, shares[0] as Share], 2)).toThrow();
  });
});
