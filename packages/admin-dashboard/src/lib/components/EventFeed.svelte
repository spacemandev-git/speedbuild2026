<script lang="ts">
  import type { BureauEvent } from '$lib/server/upstream';

  let events = $state<BureauEvent[]>([]);
  let connected = $state(false);
  let connectionMessage = $state('connecting');

  function normalizeEvent(value: unknown): BureauEvent | null {
    if (!value || typeof value !== 'object') return null;
    const event = value as Partial<BureauEvent>;
    return {
      ts: event.ts ?? Date.now(),
      type: typeof event.type === 'string' ? event.type : 'system.event',
      room: event.room,
      operativeId: event.operativeId,
      message: typeof event.message === 'string' ? event.message : undefined,
      data: event.data
    };
  }

  function eventTime(ts: string | number): string {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? String(ts) : date.toLocaleTimeString([], { hour12: false });
  }

  function badgeClass(event: BureauEvent): string {
    const label = `${event.type} ${event.room ?? ''}`.toLowerCase();
    if (label.includes('room1') || label.includes('room 1')) return 'room1';
    if (label.includes('room3') || label.includes('room 3')) return 'room3';
    if (label.includes('room5') || label.includes('room 5')) return 'room5';
    return 'bureau';
  }

  function roomLabel(room: string | number | undefined): string {
    const value = String(room ?? '').replace(/^room-?/i, '');
    return value ? `Room ${value}` : 'Room';
  }

  function eventMessage(event: BureauEvent): string {
    const operative = event.operativeId ? `${event.operativeId}: ` : '';
    if (event.type.includes('rejected') && event.message) return event.message;

    switch (event.type) {
      case 'operative.registered':
        return `${operative}operative registered.`;
      case 'override.granted':
        return `${operative}${roomLabel(event.room)} manual override granted.`;
      case 'override.completed':
        return `${operative}${roomLabel(event.room)} force completion recorded.`;
      case 'room.completed':
        return `${roomLabel(event.room)} marked complete.`;
      case 'room1.verified':
        return `${operative}Room 1 verification completed.`;
      case 'room.revealed':
        return `${operative}${roomLabel(event.room)} access revealed.`;
      default:
        return event.message ?? `${event.type} received.`;
    }
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
        const event = normalizeEvent({ type: 'system.event', message: message.data, ts: Date.now() });
        if (event) events = [event, ...events].slice(0, 100);
      }
    };

    return () => source.close();
  });
</script>

<section class="panel event-panel" aria-label="Live Bureau event feed">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">System messages</p>
      <h2>Live Bureau event feed</h2>
    </div>
    <span class="connection-state" class:online={connected}>
      <span class="status-dot" class:good={connected}></span>{connectionMessage}
    </span>
  </div>

  {#if events.length === 0}
    <div class="empty-state compact">Waiting for Bureau events.</div>
  {:else}
    <ol class="event-list">
      {#each events as event, index (`${event.ts}-${event.type}-${index}`)}
        <li>
          <time>{eventTime(event.ts)}</time>
          <span class={`event-badge ${badgeClass(event)}`}>{event.type}</span>
          <div>
            <p>{eventMessage(event)}</p>
            {#if event.operativeId}<small>{event.operativeId}</small>{/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</section>
