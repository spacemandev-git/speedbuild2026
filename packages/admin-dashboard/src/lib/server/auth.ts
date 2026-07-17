import { env } from '$env/dynamic/private';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_PAYLOAD = 'speedbuild-admin-session-v1';

function adminToken(): string {
  const token = env.SB_ADMIN_TOKEN;
  if (!token) throw new Error('SB_ADMIN_TOKEN is not configured');
  return token;
}

export function createSessionValue(): string {
  return createHmac('sha256', adminToken()).update(SESSION_PAYLOAD).digest('hex');
}

export function isValidSession(value: string | undefined): boolean {
  if (!value) return false;

  const expected = new Uint8Array(Buffer.from(createSessionValue(), 'utf8'));
  const actual = new Uint8Array(Buffer.from(value, 'utf8'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isValidAdminToken(candidate: string): boolean {
  const expected = new Uint8Array(Buffer.from(adminToken(), 'utf8'));
  const actual = new Uint8Array(Buffer.from(candidate, 'utf8'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
