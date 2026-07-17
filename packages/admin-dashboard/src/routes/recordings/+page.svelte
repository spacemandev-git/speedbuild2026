<script lang="ts">
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
    <p>Browse archived casts and active streams held by the estate’s asciinema server.</p>
  </div>
  {#if serverUrl}<a class="button secondary" href={serverUrl} target="_blank" rel="noreferrer">Open asciinema server</a>{/if}
</div>

<div class="notice">
  Raw fallback <code>.cast</code> files remain inside each participant container at <code>/var/log/sessions/</code>.
</div>

{#if serverUrl}
  <iframe class="recording-frame" src={serverUrl} title="Asciinema recordings and streams"></iframe>
{:else}
  <div class="panel empty-state">Locating the asciinema archive…</div>
{/if}
