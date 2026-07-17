import { describe, expect, test } from "bun:test";
import { claimNumber, participantName } from "../src/participants.ts";
import { generatePassword, PASSWORD_WORDS } from "../src/password.ts";

describe("participant identity derivation", () => {
  test("derives padded container and claim names", () => {
    expect(participantName(1)).toBe("p01");
    expect(participantName(30)).toBe("p30");
    expect(claimNumber(1)).toBe("CLAIMANT-01");
    expect(claimNumber(30)).toBe("CLAIMANT-30");
  });

  test("rejects numbers outside the two-digit participant range", () => {
    expect(() => participantName(0)).toThrow();
    expect(() => claimNumber(100)).toThrow();
  });
});

describe("password generation", () => {
  test("uses four words from the embedded wordlist", () => {
    expect(PASSWORD_WORDS.length).toBeGreaterThanOrEqual(190);
    expect(PASSWORD_WORDS.length).toBeLessThanOrEqual(210);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const words = generatePassword().split("-");
      expect(words).toHaveLength(4);
      expect(words.every((word) => (PASSWORD_WORDS as readonly string[]).includes(word))).toBeTrue();
    }
  });
});
