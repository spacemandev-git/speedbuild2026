<script lang="ts">
  let { data } = $props();
  let serverUrl = $state('');

  $effect(() => {
    serverUrl = `http://${window.location.hostname}:4000`;
  });
</script>

<svelte:head><title>Recordings · The Estate</title></svelte:head>

<div class="page-header">
  <div>
    <p class="eyebrow">Permanent witness</p>
    <h1>Recordings</h1>
    <p>Export terminal session recordings for every claimant in the estate.</p>
  </div>
  <div class="action-row">
    <a class="button" href="/recordings/archive" download>Export all recordings</a>
    {#if serverUrl}<a class="button secondary" href={serverUrl} target="_blank" rel="noreferrer">Open asciinema server</a>{/if}
  </div>
</div>

<div class="notice">
  The browser can’t embed the asciinema server directly. Use these buttons to download the raw <code>.cast</code>
  recordings pulled from each claimant box at <code>/var/log/sessions/</code>.
</div>

{#if data.loadError}
  <div class="error-banner">{data.loadError}</div>
{/if}

{#if data.participants.length === 0}
  <div class="panel empty-state">No claimants are available for recording export.</div>
{:else}
  <div class="table-shell">
    <table>
      <thead>
        <tr><th>Claimant</th><th>Recordings</th></tr>
      </thead>
      <tbody>
        {#each data.participants as participant (participant.name)}
          <tr>
            <td class="code">{participant.name}</td>
            <td>
              <a class="button ghost small" href={`/recordings/${encodeURIComponent(participant.name)}/archive`} download>Download .cast</a>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
