import { fetchBureauEvents } from '$lib/server/upstream';
import type { RequestHandler } from './$types';

const encoder = new TextEncoder();

export const GET: RequestHandler = async ({ request }) => {
  let upstream: Response;
  try {
    upstream = await fetchBureauEvents(request.signal);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Bureau event stream unavailable', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return new Response(detail || 'Bureau event stream unavailable', { status: 502 });
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        controller.close();
      };

      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, 15_000);

      void (async () => {
        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            const relayed = lines.filter((line) => !line.startsWith('event:')).join('\n');
            if (relayed) controller.enqueue(encoder.encode(`${relayed}\n`));
          }
          pending += decoder.decode();
          if (pending && !pending.startsWith('event:')) controller.enqueue(encoder.encode(pending));
          close();
        } catch (error) {
          if (!closed && !request.signal.aborted) controller.error(error);
          closed = true;
          clearInterval(heartbeat);
        }
      })();
    },
    async cancel() {
      closed = true;
      clearInterval(heartbeat);
      await reader.cancel();
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
};
