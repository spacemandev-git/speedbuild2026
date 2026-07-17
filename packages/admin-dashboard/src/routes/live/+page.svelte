<script lang="ts">
  import LiveTerminal from '$lib/components/LiveTerminal.svelte';
  import { isParticipantRunning, participantStatus, participantStreamToken } from '$lib/participant';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const running = $derived(data.participants.filter(isParticipantRunning));
</script>

<svelte:head><title>Live wall · The Estate</title></svelte:head>

<div class="page-header">
  <div>
    <p class="eyebrow">Witness instruments</p>
    <h1>Live wall</h1>
    <p>Terminal streams from every running claimant container.</p>
  </div>
  <span class="status-label"><span class="status-dot good"></span>{running.length} active</span>
</div>

{#if running.length === 0}
  <div class="panel empty-state">No claimant containers are currently running.</div>
{:else}
  <div class="grid live-grid">
    {#each running as participant (participant.name)}
      <section class="terminal-card">
        <div class="terminal-card-header">
          <h2><a href={`/participants/${encodeURIComponent(participant.name)}`}>{participant.name}</a></h2>
          <span class="connection-state"><span class="status-dot good"></span>{participantStatus(participant)}</span>
        </div>
        <LiveTerminal src={participantStreamToken(participant)} live />
      </section>
    {/each}
  </div>
{/if}
