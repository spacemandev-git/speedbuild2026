import { randomBytes } from "node:crypto";

export interface Share {
  index: number;
  data: Uint8Array;
}

function multiply(left: number, right: number): number {
  let a = left;
  let b = right;
  let product = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    if ((b & 1) !== 0) product ^= a;
    const carry = a & 0x80;
    a = (a << 1) & 0xff;
    if (carry !== 0) a ^= 0x1b;
    b >>>= 1;
  }
  return product;
}

function power(value: number, exponent: number): number {
  let result = 1;
  let factor = value;
  let remaining = exponent;
  while (remaining > 0) {
    if ((remaining & 1) !== 0) result = multiply(result, factor);
    factor = multiply(factor, factor);
    remaining >>>= 1;
  }
  return result;
}

function inverse(value: number): number {
  if (value === 0) throw new RangeError("zero has no multiplicative inverse in GF(256)");
  return power(value, 254);
}

function validateThreshold(k: number, n?: number): void {
  if (!Number.isSafeInteger(k) || k < 1 || k > 255) {
    throw new RangeError("k must be an integer between 1 and 255");
  }
  if (n !== undefined && (!Number.isSafeInteger(n) || n < k || n > 255)) {
    throw new RangeError("n must be an integer between k and 255");
  }
}

export function split(secret: Uint8Array, k: number, n: number): Share[] {
  validateThreshold(k, n);
  const shares = Array.from({ length: n }, (_, offset) => ({
    index: offset + 1,
    data: new Uint8Array(secret.length),
  }));

  for (let position = 0; position < secret.length; position += 1) {
    const coefficients = new Uint8Array(k);
    coefficients[0] = secret[position] ?? 0;
    if (k > 1) coefficients.set(randomBytes(k - 1), 1);
    for (const share of shares) {
      let value = coefficients[k - 1] ?? 0;
      for (let coefficient = k - 2; coefficient >= 0; coefficient -= 1) {
        value = multiply(value, share.index) ^ (coefficients[coefficient] ?? 0);
      }
      share.data[position] = value;
    }
  }
  return shares;
}

export function combine(shares: Share[], k: number): Uint8Array {
  validateThreshold(k);
  if (shares.length < k) throw new RangeError(`at least ${k} shares are required`);
  const selected = shares.slice(0, k);
  const length = selected[0]?.data.length ?? 0;
  const indices = new Set<number>();
  for (const share of selected) {
    if (!Number.isSafeInteger(share.index) || share.index < 1 || share.index > 255) {
      throw new RangeError("share indices must be integers between 1 and 255");
    }
    if (indices.has(share.index)) throw new RangeError("share indices must be distinct");
    if (share.data.length !== length) throw new RangeError("share data lengths must match");
    indices.add(share.index);
  }

  const secret = new Uint8Array(length);
  for (let position = 0; position < length; position += 1) {
    let value = 0;
    for (let i = 0; i < selected.length; i += 1) {
      const current = selected[i];
      if (!current) continue;
      let numerator = 1;
      let denominator = 1;
      for (let j = 0; j < selected.length; j += 1) {
        if (i === j) continue;
        const other = selected[j];
        if (!other) continue;
        numerator = multiply(numerator, other.index);
        denominator = multiply(denominator, current.index ^ other.index);
      }
      const basis = multiply(numerator, inverse(denominator));
      value ^= multiply(current.data[position] ?? 0, basis);
    }
    secret[position] = value;
  }
  return secret;
}
