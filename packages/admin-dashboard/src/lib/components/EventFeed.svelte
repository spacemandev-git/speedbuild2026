<script lang="ts">
  import type { EstateEvent } from '$lib/server/upstream';

  let events = $state<EstateEvent[]>([]);
  let connected = $state(false);
  let connectionMessage = $state('connecting');

  function normalizeEvent(value: unknown): EstateEvent | null {
    if (!value || typeof value !== 'object') return null;
    const event = value as Partial<EstateEvent>;
    return {
      ts: event.ts ?? Date.now(),
      type: typeof event.type === 'string' ? event.type : 'estate',
      room: event.room,
      claimNumber: event.claimNumber,
      message: typeof event.message === 'string' ? event.message : JSON.stringify(event.data ?? value),
      data: event.data
    };
  }

  function eventTime(ts: string | number): string {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? String(ts) : date.toLocaleTimeString([], { hour12: false });
  }

  function badgeClass(event: EstateEvent): string {
    const label = `${event.type} ${event.room ?? ''}`.toLowerCase();
    if (label.includes('auditor') || label.includes('room1') || label.includes('room 1')) return 'auditor';
    if (label.includes('tempter') || label.includes('room3') || label.includes('room 3')) return 'tempter';
    if (label.includes('actuary') || label.includes('room5') || label.includes('room 5')) return 'actuary';
    return 'estate';
  }

  $effect(() => {
    const source = new EventSource('/api/events');

    source.onopen = () => {
      connected = true;
      connectionMessage = 'live';
    };
    source.onerror = () => {
      connected = false;
      connectionMessage = 'reconnecting';
    };
    source.onmessage = (message) => {
      try {
        const event = normalizeEvent(JSON.parse(message.data));
        if (event) events = [event, ...events].slice(0, 100);
      } catch {
        const event = normalizeEvent({ type: 'estate', message: message.data, ts: Date.now() });
        if (event) events = [event, ...events].slice(0, 100);
      }
    };

    return () => source.close();
  });
</script>

<section class="panel event-panel" aria-label="Live estate event feed">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">Executor dispatches</p>
      <h2>Live estate feed</h2>
    </div>
    <span class="connection-state" class:online={connected}>
      <span class="status-dot" class:good={connected}></span>{connectionMessage}
    </span>
  </div>

  {#if events.length === 0}
    <div class="empty-state compact">Awaiting the next consequential act of the estate.</div>
  {:else}
    <ol class="event-list">
      {#each events as event, index (`${event.ts}-${event.type}-${index}`)}
        <li>
          <time>{eventTime(event.ts)}</time>
          <span class={`event-badge ${badgeClass(event)}`}>{event.room ? `room ${event.room}` : event.type}</span>
          <div>
            <p>{event.message}</p>
            {#if event.claimNumber}<small>{event.claimNumber}</small>{/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</section>
