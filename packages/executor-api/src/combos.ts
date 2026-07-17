import { createHmac } from "node:crypto";
import bs58 from "bs58";

function secretFromEnvironment(): string {
  const secret = process.env.SB_ESTATE_SECRET;
  if (!secret) throw new Error("SB_ESTATE_SECRET is required to derive an unlock");
  return secret;
}

export function secretKey(secret: string): string | Buffer {
  // Production config is hex; accepting non-hex strings keeps local smoke boots ergonomic.
  return secret.length > 0 && secret.length % 2 === 0 && /^[0-9a-f]+$/i.test(secret)
    ? Buffer.from(secret, "hex")
    : secret;
}

export function hmac(secret: string, claimNumber: string, roomId: string): Buffer {
  return createHmac("sha256", secretKey(secret)).update(claimNumber).update(roomId).digest();
}

export function fourDigit(claimNumber: string, roomId: string, secret = secretFromEnvironment()): string {
  const value = hmac(secret, claimNumber, roomId).readUIntBE(0, 4) % 10_000;
  return value.toString().padStart(4, "0");
}

export function fragment(
  claimNumber: string,
  roomId: string,
  length: number,
  secret = secretFromEnvironment(),
): string {
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("fragment length must be non-negative");
  return bs58.encode(hmac(secret, claimNumber, roomId)).slice(0, length);
}

export function flashSeconds(hopsCorrect: number): number {
  return Math.min(10, Math.max(3, 3 + Math.trunc(hopsCorrect)));
}
