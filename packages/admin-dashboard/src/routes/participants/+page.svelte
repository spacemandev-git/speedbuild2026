<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    participantOperativeId,
    participantIp,
    participantRooms,
    participantSshPort,
    participantStatus
  } from '$lib/participant';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  function confirmAction(event: SubmitEvent, message: string): void {
    if (!window.confirm(message)) event.preventDefault();
  }

  function openRow(event: MouseEvent | KeyboardEvent, name: string): void {
    if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
    if ((event.target as HTMLElement).closest('a, button, form, input')) return;
    if (event instanceof KeyboardEvent) event.preventDefault();
    void goto(`/participants/${encodeURIComponent(name)}`);
  }
</script>

<svelte:head><title>Operatives · The Bureau</title></svelte:head>

<div class="page-header">
  <div>
    <p class="eyebrow">Operative registry</p>
    <h1>Operatives</h1>
    <p>Provision operative environments, control containers, and inspect access credentials.</p>
  </div>
  <div class="action-row">
    <form method="POST" action="?/provision">
      <button class="button" type="submit">Provision participant</button>
    </form>
    <form method="POST" action="?/resetAll" onsubmit={(event) => confirmAction(event, 'Reset ALL operatives while preserving identity?')}>
      <button class="button ghost" type="submit">Reset all</button>
    </form>
    <form method="POST" action="?/removeAll" onsubmit={(event) => confirmAction(event, 'Delete ALL operatives and their environments? This cannot be undone.')}>
      <button class="button danger" type="submit">Delete all operatives</button>
    </form>
  </div>
</div>

{#if form && 'error' in form && form.error}<div class="error-banner">{form.error}</div>{/if}
{#if form && 'message' in form && form.message}<div class="notice">{form.message}</div>{/if}

{#if data.participants.length === 0}
  <div class="panel empty-state">No operatives are registered. Provision the first participant when ready.</div>
{:else}
  <div class="table-shell">
    <table>
      <thead>
        <tr><th>Name</th><th>Operative ID</th><th>Address</th><th>SSH</th><th>Status</th><th>Revealed rooms</th><th>Controls</th></tr>
      </thead>
      <tbody>
        {#each data.participants as participant (participant.name)}
          <tr
            class="clickable"
            tabindex="0"
            onclick={(event) => openRow(event, participant.name)}
            onkeydown={(event) => openRow(event, participant.name)}
          >
            <td class="name-cell"><a href={`/participants/${encodeURIComponent(participant.name)}`}>{participant.name}</a></td>
            <td class="code">{participantOperativeId(participant)}</td>
            <td class="code">{participantIp(participant)}</td>
            <td>{participantSshPort(participant) ?? '—'}</td>
            <td><span class="pill" class:good={participantStatus(participant).toLowerCase() === 'running'}>{participantStatus(participant)}</span></td>
            <td>
              <div class="pill-list">
                {#each participantRooms(participant) as room (room)}<span class="pill">R{room.replace(/\D/g, '') || room}</span>{/each}
                {#if participantRooms(participant).length === 0}<span class="muted-copy">none</span>{/if}
              </div>
            </td>
            <td>
              <div class="action-row">
                {#if participantStatus(participant).toLowerCase() === 'running'}
                  <form class="inline-form" method="POST" action="?/control">
                    <input type="hidden" name="name" value={participant.name} />
                    <input type="hidden" name="operation" value="suspend" />
                    <button class="button ghost small" type="submit">Suspend</button>
                  </form>
                {:else}
                  <form class="inline-form" method="POST" action="?/control">
                    <input type="hidden" name="name" value={participant.name} />
                    <input type="hidden" name="operation" value="resume" />
                    <button class="button secondary small" type="submit">Resume</button>
                  </form>
                {/if}
                <form class="inline-form" method="POST" action="?/control" onsubmit={(event) => confirmAction(event, `Reset ${participant.name} while preserving identity?`)}>
                  <input type="hidden" name="name" value={participant.name} />
                  <input type="hidden" name="operation" value="reset" />
                  <button class="button ghost small" type="submit">Reset</button>
                </form>
                <form class="inline-form" method="POST" action="?/remove" onsubmit={(event) => confirmAction(event, `Delete ${participant.name} and its environment?`)}>
                  <input type="hidden" name="name" value={participant.name} />
                  <button class="button danger small" type="submit">Delete</button>
                </form>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
