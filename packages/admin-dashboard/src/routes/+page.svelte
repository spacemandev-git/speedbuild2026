<script lang="ts">
  import EventFeed from '$lib/components/EventFeed.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type ZoneView = { name: string; status?: string; ip?: string; services?: Record<string, unknown>; healthy?: boolean };

  const zones = $derived.by((): ZoneView[] => {
    if (!data.zones.ok) return [];
    const payload = data.zones.data;
    if (Array.isArray(payload)) return payload;
    return Object.entries(payload).map(([name, zone]) => ({ ...zone, name: zone.name ?? name }));
  });

  function healthy(status: string | undefined): boolean {
    return ['running', 'active', 'healthy', 'ok'].includes((status ?? '').toLowerCase());
  }

  function describe(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if (typeof object.status === 'string') return object.status;
      if (typeof object.message === 'string') return object.message;
    }
    return value == null ? 'no response' : 'responding';
  }
</script>

<div class="page-header">
  <div>
    <p class="eyebrow">Estate telemetry</p>
    <h1>Operations overview</h1>
    <p>A live reading of the rooms, executors, and claimant infrastructure.</p>
  </div>
</div>

<section class="grid health-grid" aria-label="Zone health">
  {#if data.zones.ok}
    {#each zones as zone}
      <article class="health-card">
        <div class="health-card-header">
          <h2>{zone.name}</h2>
          <span class="status-label"><span class="status-dot" class:good={zone.healthy ?? healthy(zone.status)}></span>{zone.status ?? 'unknown'}</span>
        </div>
        <strong class="metric">{zone.ip ?? 'zone online'}</strong>
        <small>{zone.services ? `${Object.keys(zone.services).length} services observed` : 'service state from host agent'}</small>
      </article>
    {/each}
  {:else}
    <article class="health-card error">
      <div class="health-card-header"><h2>Zone registry</h2><span class="status-label"><span class="status-dot bad"></span>unavailable</span></div>
      <small>{data.zones.error}</small>
    </article>
  {/if}

  <article class="health-card" class:error={!data.surfpoolHealth.ok}>
    <div class="health-card-header">
      <h2>Surfpool</h2>
      <span class="status-label"><span class="status-dot" class:good={data.surfpoolHealth.ok}></span>{data.surfpoolHealth.ok ? 'responding' : 'fault'}</span>
    </div>
    <strong class="metric">{data.surfpoolSlot.ok ? `slot ${data.surfpoolSlot.data.toLocaleString()}` : 'slot unavailable'}</strong>
    <small>{data.surfpoolHealth.ok ? data.surfpoolHealth.data : data.surfpoolHealth.error}</small>
  </article>

  <article class="health-card" class:error={!data.llama.ok}>
    <div class="health-card-header">
      <h2>Inference</h2>
      <span class="status-label"><span class="status-dot" class:good={data.llama.ok}></span>{data.llama.ok ? 'responding' : 'fault'}</span>
    </div>
    <strong class="metric">llama-server</strong>
    <small>{data.llama.ok ? describe(data.llama.data) : data.llama.error}</small>
  </article>

  <article class="health-card" class:error={data.participantCount === null}>
    <div class="health-card-header">
      <h2>Claimants</h2>
      <span class="status-label"><span class="status-dot" class:good={data.participantCount !== null}></span>registered</span>
    </div>
    <strong class="metric">{data.participantCount ?? '—'}</strong>
    <small>{data.participantError ?? 'participant estates under administration'}</small>
  </article>
</section>

<EventFeed />
