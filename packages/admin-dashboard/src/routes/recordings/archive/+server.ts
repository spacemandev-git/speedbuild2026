import { fetchAllRecordingsArchive } from '$lib/server/upstream';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  let upstream: Response;
  try {
    upstream = await fetchAllRecordingsArchive();
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Recordings unavailable', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return new Response(detail || 'Recordings unavailable', { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/x-tar',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="bureau-recordings.tar"',
      'cache-control': 'no-store'
    }
  });
};
