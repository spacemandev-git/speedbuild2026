<script lang="ts">
  import type { LockRecord, OperativeProgress, RoomState } from '$lib/server/upstream';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let revealAllLocks = $state(false);
  let revealedLocks = $state<Record<string, boolean>>({});

  const rooms = [
    { number: 1, id: 'room1', label: 'Room 1 — Operation' },
    { number: 2, id: 'room2', label: 'Room 2 — Assembly' },
    { number: 3, id: 'room3', label: 'Room 3 — Trust' },
    { number: 4, id: 'room4', label: 'Room 4 — Minesweeper' },
    { number: 5, id: 'room5', label: 'Room 5 — Memory Path' }
  ];

  function roomState(operative: OperativeProgress, room: { number: number; id: string }): RoomState {
    const states = operative.rooms && typeof operative.rooms === 'object' ? operative.rooms : {};
    return states[String(room.number)] ?? states[room.id] ?? states[`room-${room.number}`] ?? { status: 'not started' };
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
  const room3Attempts = $derived.by(() => {
    const direct = firstArray([
      ['room3Attempts'],
      ['attempts'],
      ['room3', 'attempts'],
      ['room3', 'reconstructionAttempts']
    ]);
    if (direct.length > 0) return direct;

    for (const item of data.state.roomState ?? []) {
      const row = asObject(item);
      if (row?.room === 'room3' && row.key === 'history' && Array.isArray(row.value)) {
        return row.value;
      }
    }
    return [];
  });

  function renderItem(item: unknown): string {
    return typeof item === 'string' ? item : JSON.stringify(item, null, 2);
  }

  function scoreboardLine(item: unknown): string {
    const score = asObject(item);
    if (!score) return renderItem(item);

    const operativeId = typeof score.operativeId === 'string' ? score.operativeId : 'UNKNOWN';
    const hops = score.hopsCorrect ?? score.hops_correct ?? score.routeProgress ?? '—';
    const total = score.routeTotal ?? score.route_total ?? 7;
    const seconds = score.flashSeconds ?? score.flash_seconds ?? score.seconds ?? '—';
    return `${operativeId} — ROUTE ${String(hops)}/${String(total)} — ${String(seconds)}s`;
  }

  function confirmAction(event: SubmitEvent, message: string): void {
    if (!window.confirm(message)) event.preventDefault();
  }

  function lockKey(lock: LockRecord): string {
    return `${lock.room}-${lock.lock}`;
  }

  function lockCodeVisible(lock: LockRecord): boolean {
    return revealAllLocks || Boolean(revealedLocks[lockKey(lock)]);
  }

  function toggleLock(lock: LockRecord): void {
    const key = lockKey(lock);
    revealedLocks[key] = !revealedLocks[key];
  }

  function roomLabel(roomId: string): string {
    return rooms.find((room) => room.id === roomId)?.label ?? roomId;
  }

  function roomIsComplete(room: { number: number; id: string }): boolean {
    return data.roomsComplete.some((value) => value === room.id || value === String(room.number) || value === `room-${room.number}`);
  }
</script>

<svelte:head><title>Challenge rooms · The Bureau</title></svelte:head>

<div class="page-header">
  <div>
    <p class="eyebrow">Room operations</p>
    <h1>Challenge rooms</h1>
    <p>Bureau state by operative, with room reveal and manual override controls.</p>
  </div>
  <div class="action-row">
    {#each rooms as room (room.id)}
      <form method="POST" action="?/revealAll">
        <input type="hidden" name="room" value={room.number} />
        <button class="button small" type="submit">Reveal {room.label} to all</button>
      </form>
    {/each}
  </div>
</div>

{#if form && 'error' in form && form.error}<div class="error-banner">{form.error}</div>{/if}
{#if form && 'message' in form && form.message}
  <div class="notice action-result">
    <span>{form.message}</span>
    {#if 'unlock' in form && form.unlock && 'unlockLabel' in form}
      <span class="result-unlock"><span>{form.unlockLabel}</span><code>{form.unlock}</code></span>
    {/if}
  </div>
{/if}

<section class="panel locks-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">Lock sheet</p>
      <h2>Locks</h2>
    </div>
    <div class="action-row">
      <span class="pill">Pool {data.lockPool}</span>
      <button
        class="button secondary small"
        type="button"
        aria-pressed={revealAllLocks}
        onclick={() => revealAllLocks = !revealAllLocks}
      >
        {revealAllLocks ? 'Mask all' : 'Reveal all'}
      </button>
    </div>
  </div>
  {#if data.locks.length === 0}
    <div class="empty-state compact">No lock data is available.</div>
  {:else}
    <div class="table-shell">
      <table class="locks-table">
        <thead>
          <tr><th>Room</th><th>Lock #</th><th>Group</th><th>Live operative</th><th>Live code</th></tr>
        </thead>
        <tbody>
          {#each data.locks as lock (lockKey(lock))}
            <tr>
              <td>{roomLabel(lock.room)}</td>
              <td>{lock.lock}</td>
              <td><span class="code">{lock.members.join(', ') || '—'}</span></td>
              <td><span class="code">{lock.liveOperative || '—'}</span></td>
              <td>
                <div class="lock-code">
                  <code>{lockCodeVisible(lock) ? lock.liveCode : '••••'}</code>
                  <button
                    class="button ghost small"
                    type="button"
                    aria-label={`${lockCodeVisible(lock) ? 'Mask' : 'Reveal'} ${roomLabel(lock.room)} lock ${lock.lock} code`}
                    aria-pressed={lockCodeVisible(lock)}
                    disabled={revealAllLocks}
                    onclick={() => toggleLock(lock)}
                  >
                    {revealAllLocks ? 'Revealed' : lockCodeVisible(lock) ? 'Mask' : 'Reveal'}
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<div class="table-shell challenge-matrix">
  <table class="matrix">
    <thead>
      <tr>
        <th>Operative</th>
        {#each rooms as room (room.id)}
          {@const complete = roomIsComplete(room)}
          <th>
            <div class="room-column-heading">
              <span>{room.label}</span>
              {#if complete}<span class="pill good">COMPLETE</span>{/if}
              <form
                method="POST"
                action="?/roomComplete"
                onsubmit={(event) => confirmAction(event, `Mark ${room.label} complete and advance?`)}
              >
                <input type="hidden" name="room" value={room.number} />
                <button class="button secondary small" type="submit" disabled={complete}>Mark room complete</button>
              </form>
            </div>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#if data.state.operatives.length === 0}
        <tr><td colspan="6"><div class="empty-state compact">The Bureau state contains no operatives.</div></td></tr>
      {:else}
        {#each data.state.operatives as operative (operative.operativeId)}
          <tr>
            <td>{operative.operativeId}</td>
            {#each rooms as room (room.id)}
              {@const state = roomState(operative, room)}
              <td title={detail(state)}>
                <span class={`room-status ${statusClass(state.status)}`}>{state.status}</span>
                <form class="override-form" method="POST" action="?/override">
                  <input type="hidden" name="operativeId" value={operative.operativeId} />
                  <input type="hidden" name="room" value={room.number} />
                  <button class="button ghost small" type="submit">Manual override</button>
                </form>
                <form
                  class="override-form"
                  method="POST"
                  action="?/forceComplete"
                  onsubmit={(event) => confirmAction(event, `Force completion for ${operative.operativeId} in ${room.label}?`)}
                >
                  <input type="hidden" name="operativeId" value={operative.operativeId} />
                  <input type="hidden" name="room" value={room.number} />
                  <button class="button danger small" type="submit">Force complete</button>
                </form>
              </td>
            {/each}
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<div class="grid room-panels">
  <section class="panel">
    <div class="panel-heading"><div><p class="eyebrow">Room 3 — Trust</p><h2>Room 3 reconstruction setup</h2></div></div>
    <p class="muted-copy">Select exactly six operatives and flag exactly two for the reconstruction configuration.</p>
    {#if data.state.operatives.length === 0}
      <div class="empty-state compact">No operatives are available.</div>
    {:else}
      <form method="POST" action="?/configureRoom3">
        <table class="matrix">
          <thead><tr><th>Operative</th><th>Include</th><th>Flag</th></tr></thead>
          <tbody>
            {#each data.state.operatives as operative (operative.operativeId)}
              <tr>
                <td>{operative.operativeId}</td>
                <td><input type="checkbox" name="operative" value={operative.operativeId} /></td>
                <td><input type="checkbox" name="selected" value={operative.operativeId} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button class="button" type="submit">Configure Room 3</button>
      </form>
    {/if}
  </section>
  <section class="panel">
    <div class="panel-heading"><div><p class="eyebrow">Room 5 — Memory Path · prize clock</p><h2>Room 5 scoreboard</h2></div><span class="pill">{room5Scoreboard.length} entries</span></div>
    {#if room5Scoreboard.length === 0}
      <div class="empty-state compact">No Room 5 scoreboard data is present in the state dump.</div>
    {:else}
      <ol class="data-list">{#each room5Scoreboard as item, index (index)}<li><span class="code">{scoreboardLine(item)}</span></li>{/each}</ol>
    {/if}
  </section>
  <section class="panel">
    <div class="panel-heading"><div><p class="eyebrow">Room 3 — Trust</p><h2>Room 3 reconstruction attempts</h2></div><span class="pill">{room3Attempts.length} attempts</span></div>
    {#if room3Attempts.length === 0}
      <div class="empty-state compact">No Room 3 attempt data is present in the state dump.</div>
    {:else}
      <ol class="data-list">{#each room3Attempts as item, index (index)}<li><pre class="json-detail">{renderItem(item)}</pre></li>{/each}</ol>
    {/if}
  </section>
</div>
