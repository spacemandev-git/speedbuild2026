import { hostAgent } from '$lib/server/upstream';
import type { PageServerLoad } from './$types';

type HealthResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function capture<T>(operation: () => Promise<T>): Promise<HealthResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function surfpoolRpc<T>(method: 'getHealth' | 'getSlot'): Promise<T> {
  const response = await fetch('http://10.61.0.20:8899', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method })
  });
  if (!response.ok) throw new Error(`Surfpool returned HTTP ${response.status}`);

  const payload = (await response.json()) as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? `${method} failed`);
  if (payload.result === undefined) throw new Error(`${method} returned no result`);
  return payload.result;
}

export const load: PageServerLoad = async () => {
  const [zones, participants, surfpoolHealth, surfpoolSlot] = await Promise.all([
    capture(() => hostAgent.zones()),
    capture(() => hostAgent.participants()),
    capture(() => surfpoolRpc<string>('getHealth')),
    capture(() => surfpoolRpc<number>('getSlot'))
  ]);

  return {
    zones,
    participantCount: participants.ok ? participants.data.length : null,
    participantError: participants.ok ? null : participants.error,
    surfpoolHealth,
    surfpoolSlot
  };
};
