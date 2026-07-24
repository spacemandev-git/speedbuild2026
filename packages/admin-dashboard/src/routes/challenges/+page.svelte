<script lang="ts">
  import type { ClaimantState, RoomState } from '$lib/server/upstream';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const rooms = [1, 2, 3, 4, 5];

  function roomState(claimant: ClaimantState, room: number): RoomState {
    const states = claimant.rooms && typeof claimant.rooms === 'object' ? claimant.rooms : {};
    return states[String(room)] ?? states[`room${room}`] ?? states[`room-${room}`] ?? { status: 'sealed' };
  }

  function statusClass(status: string): string {
    return status.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  function detail(state: RoomState): string {
    if (state.detail === undefined) return state.status;
    return typeof state.detail === 'string' ? state.detail : JSON.stringify(state.detail);
  }

  function asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  function firstArray(paths: Array<[string, string?]>): unknown[] {
    const state = data.state as Record<string, unknown>;
    for (const [first, second] of paths) {
      const value = second ? asObject(state[first])?.[second] : state[first];
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  const room5Scoreboard = $derived(firstArray([
    ['room5Scoreboard'],
    ['scoreboard'],
    ['room5', 'scoreboard'],
    ['room5', 'scores']
  ]));
  const room3Attempts = $derived(firstArray([
    ['room3Attempts'],
    ['attempts'],
    ['room3', 'attempts'],
    ['room3', 'reconstructionAttempts']
  ]));

  function renderItem(item: unknown): string {
    return typeof item === 'string' ? item : JSON.stringify(item, null, 2);
  }
</script>

<svelte:head><title>Challenge rooms · The Estate</title></svelte:head>

<div class="page-header">
  <div>
    <p class="eyebrow">The clauses</p>
    <h1>Challenge rooms</h1>
    <p>Executor state by claimant. Mercy is consequential, visible, and deliberately irreversible.</p>
  </div>
  <div class="action-row">
    {#each rooms as room}
      <form method="POST" action="?/revealAll">
        <input type="hidden" name="room" value={room} />
        <button class="button small" type="submit">Reveal room {room} to all</button>
      </form>
    {/each}
  </div>
</div>

{#if form && 'error' in form && form.error}<div class="error-banner">{form.error}</div>{/if}
{#if form && 'message' in form && form.message}<div class="notice">{form.message}</div>{/if}

{#if data.state.claimants.length === 0}
  <div class="panel empty-state">The executor state contains no claimants.</div>
{:else}
  <div class="table-shell">
    <table class="matrix">
      <thead><tr><th>Claimant</th>{#each rooms as room}<th>Room {room}</th>{/each}</tr></thead>
      <tbody>
        {#each data.state.claimants as claimant (claimant.claimNumber)}
          <tr>
            <td>{claimant.claimNumber}</td>
            {#each rooms as room}
              {@const state = roomState(claimant, room)}
              <td title={detail(state)}>
                <span class={`room-status ${statusClass(state.status)}`}>{state.status}</span>
                <form class="mercy-form" method="POST" action="?/mercy">
                  <input type="hidden" name="claimNumber" value={claimant.claimNumber} />
                  <input type="hidden" name="room" value={room} />
                  <button class="button ghost small" type="submit">Mercy</button>
                </form>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<div class="grid room-panels">
  <section class="panel">
    <div class="panel-heading"><div><p class="eyebrow">Room III · The Séance</p><h2>Begin the séance</h2></div></div>
    <p class="muted-copy">Seat exactly six participants and mark exactly two as bought, then begin the round.</p>
    {#if data.state.claimants.length === 0}
      <div class="empty-state compact">No claimants are present to seat.</div>
    {:else}
      <form method="POST" action="?/beginSeance">
        <table class="matrix">
          <thead><tr><th>Claimant</th><th>Participant</th><th>Bought</th></tr></thead>
          <tbody>
            {#each data.state.claimants as claimant (claimant.claimNumber)}
              <tr>
                <td>{claimant.claimNumber}</td>
                <td><input type="checkbox" name="participant" value={claimant.claimNumber} /></td>
                <td><input type="checkbox" name="bought" value={claimant.claimNumber} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button class="button" type="submit">Begin séance</button>
      </form>
    {/if}
  </section>
  <section class="panel">
    <div class="panel-heading"><div><p class="eyebrow">Room V · The Ledger</p><h2>Flash scoreboard</h2></div><span class="pill">{room5Scoreboard.length} entries</span></div>
    {#if room5Scoreboard.length === 0}
      <div class="empty-state compact">No Room 5 scoreboard data is present in the state dump.</div>
    {:else}
      <ol class="data-list">{#each room5Scoreboard as item}<li><pre class="json-detail">{renderItem(item)}</pre></li>{/each}</ol>
    {/if}
  </section>
  <section class="panel">
    <div class="panel-heading"><div><p class="eyebrow">Room III · The Séance</p><h2>Reconstruction attempts</h2></div><span class="pill">{room3Attempts.length} attempts</span></div>
    {#if room3Attempts.length === 0}
      <div class="empty-state compact">No Room 3 attempt data is present in the state dump.</div>
    {:else}
      <ol class="data-list">{#each room3Attempts as item}<li><pre class="json-detail">{renderItem(item)}</pre></li>{/each}</ol>
    {/if}
  </section>
</div>
