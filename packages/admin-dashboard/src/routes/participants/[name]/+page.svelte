<script lang="ts">
  import LiveTerminal from '$lib/components/LiveTerminal.svelte';
  import {
    participantApiKey,
    participantClaim,
    participantIp,
    participantPassword,
    participantPublicKey,
    participantRooms,
    participantSshPort,
    participantStatus,
    participantStreamToken,
    participantWarnings
  } from '$lib/participant';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  // svelte-ignore state_referenced_locally -- seed value only; user may edit the host field
  let sshHost = $state(participantIp(data.participant));

  const revealed = $derived(participantRooms(data.participant));
  const warnings = $derived(participantWarnings(data.participant));
  const sshCommand = $derived(
    participantSshPort(data.participant)
      ? `ssh -p ${participantSshPort(data.participant)} claimant@${sshHost}`
      : `ssh claimant@${sshHost}`
  );

  $effect(() => {
    sshHost = window.location.hostname;
  });

  function isRevealed(room: number): boolean {
    return revealed.some((value) => value === String(room) || value === `room${room}` || value === `room-${room}`);
  }

  function confirmAction(event: SubmitEvent, message: string): void {
    if (!window.confirm(message)) event.preventDefault();
  }
</script>

<svelte:head><title>{data.participant.name} · The Estate</title></svelte:head>

<div class="page-header">
  <div>
    <p class="eyebrow">{participantClaim(data.participant)}</p>
    <h1>{data.participant.name}</h1>
    <p>{participantIp(data.participant)} · SSH {participantSshPort(data.participant) ?? 'unassigned'} · {participantStatus(data.participant)}</p>
  </div>
  <div class="action-row">
    <form method="POST" action="?/control">
      <input type="hidden" name="operation" value={participantStatus(data.participant).toLowerCase() === 'running' ? 'suspend' : 'resume'} />
      <button class="button secondary" type="submit">{participantStatus(data.participant).toLowerCase() === 'running' ? 'Suspend' : 'Resume'}</button>
    </form>
    <form method="POST" action="?/control" onsubmit={(event) => confirmAction(event, `Reset ${data.participant.name} while preserving identity and reveals?`)}>
      <input type="hidden" name="operation" value="reset" />
      <button class="button ghost" type="submit">Reset</button>
    </form>
    <form method="POST" action="?/remove" onsubmit={(event) => confirmAction(event, `Permanently remove ${data.participant.name}?`)}>
      <button class="button danger" type="submit">Delete</button>
    </form>
  </div>
</div>

{#if form && 'error' in form && form.error}<div class="error-banner">{form.error}</div>{/if}
{#if form && 'message' in form && form.message}<div class="notice">{form.message}</div>{/if}

<div class="grid detail-grid">
  <div class="grid">
    <section class="panel">
      <div class="panel-heading"><div><p class="eyebrow">Entrusted secrets</p><h2>Credentials</h2></div></div>
      <dl class="credential-list">
        <div><dt>SSH command</dt><dd>{sshCommand}</dd></div>
        <div><dt>Password</dt><dd>{participantPassword(data.participant) ?? 'not retained'}</dd></div>
        <div><dt>Wallet public key</dt><dd>{participantPublicKey(data.participant) ?? 'not reported'}</dd></div>
        <div><dt>Estate API key</dt><dd>{participantApiKey(data.participant) ?? 'not reported'}</dd></div>
      </dl>
      {#if warnings.length > 0}
        <ul class="warning-list">{#each warnings as warning}<li>{warning}</li>{/each}</ul>
      {/if}
    </section>

    <section class="panel">
      <div class="panel-heading"><div><p class="eyebrow">Clause access</p><h2>Revealed rooms</h2></div></div>
      <div class="pill-list">
        {#each revealed as room}<span class="pill good">{room}</span>{/each}
        {#if revealed.length === 0}<span class="muted-copy">No room briefs have been delivered.</span>{/if}
      </div>
      <div class="room-actions">
        {#each [1, 2, 3, 4, 5] as room}
          <form method="POST" action="?/reveal">
            <input type="hidden" name="room" value={room} />
            <button class="button small" type="submit" disabled={isRevealed(room)}>Room {room}</button>
          </form>
        {/each}
      </div>
    </section>
  </div>

  <section class="terminal-card">
    <div class="terminal-card-header">
      <h2>Live terminal · {data.participant.name}</h2>
      <span class="connection-state"><span class="status-dot good"></span>asciinema</span>
    </div>
    <LiveTerminal src={participantStreamToken(data.participant)} live />
  </section>
</div>
