import { createHmac } from "node:crypto";
import bs58 from "bs58";

function secretFromEnvironment(): string {
  const secret = process.env.SB_BUREAU_SECRET;
  if (!secret) throw new Error("SB_BUREAU_SECRET is required to derive an unlock");
  return secret;
}

export function secretKey(secret: string): string | Buffer {
  // Production config is hex; accepting non-hex strings keeps local smoke boots ergonomic.
  return secret.length > 0 && secret.length % 2 === 0 && /^[0-9a-f]+$/i.test(secret)
    ? Buffer.from(secret, "hex")
    : secret;
}

export function hmac(secret: string, operativeId: string, roomId: string): Buffer {
  return createHmac("sha256", secretKey(secret)).update(operativeId).update(roomId).digest();
}

export function fourDigit(operativeId: string, roomId: string, secret = secretFromEnvironment()): string {
  const value = hmac(secret, operativeId, roomId).readUIntBE(0, 4) % 10_000;
  return value.toString().padStart(4, "0");
}

export function fragment(
  operativeId: string,
  roomId: string,
  length: number,
  secret = secretFromEnvironment(),
): string {
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("fragment length must be non-negative");
  return bs58.encode(hmac(secret, operativeId, roomId)).slice(0, length);
}

export function operativeId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw new RangeError("operative number must be an integer between 1 and 99");
  }
  return `OPERATIVE-${String(n).padStart(2, "0")}`;
}

export interface LockAssignment {
  room: "room1" | "room2";
  lock: number;
  members: string[];
  liveOperative: string;
  liveCode: string;
}

export function lockAssignments(secret: string, pool: number): LockAssignment[] {
  if (!Number.isInteger(pool) || pool < 16) {
    throw new RangeError("operative pool must be an integer of at least 16");
  }
  const rooms = [
    { room: "room1", groupSize: 4 },
    { room: "room2", groupSize: 3 },
  ] as const;
  return rooms.flatMap(({ room, groupSize }) => {
    return Array.from({ length: 4 }, (_, index) => {
      const lock = index + 1;
      const firstMember = groupSize * index + 1;
      const members = Array.from({ length: groupSize }, (_, memberIndex) => {
        return operativeId(firstMember + memberIndex);
      });
      const liveIndex = hmac(secret, `lock:${room}:${lock}`, "live").readUIntBE(0, 4) % groupSize;
      const liveOperative = members[liveIndex]!;
      return {
        room,
        lock,
        members,
        liveOperative,
        liveCode: fourDigit(liveOperative, room, secret),
      };
    });
  });
}

export function flashSeconds(hopsCorrect: number): number {
  return Math.min(10, Math.max(3, 3 + Math.trunc(hopsCorrect)));
}
