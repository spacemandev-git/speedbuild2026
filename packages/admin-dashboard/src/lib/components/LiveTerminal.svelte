<script lang="ts">
  type Props = {
    src: string | null;
    live?: boolean;
  };

  let { src, live = false }: Props = $props();
  let mount = $state<HTMLDivElement>();
  let loadError = $state('');

  $effect(() => {
    if (!mount || !src) return;

    let cancelled = false;
    let player: { dispose(): void } | undefined;
    const target = mount;
    loadError = '';
    target.replaceChildren();

    const source = live
      ? `ws://${window.location.hostname}:4000/ws/s/${encodeURIComponent(src)}`
      : src;

    void Promise.all([
      import('asciinema-player'),
      import('asciinema-player/dist/bundle/asciinema-player.css')
    ])
      .then(([AsciinemaPlayer]) => {
        if (cancelled) return;
        player = AsciinemaPlayer.create(source, target, {
          autoPlay: true,
          fit: 'width',
          idleTimeLimit: 2,
          terminalFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) loadError = error instanceof Error ? error.message : 'Player failed to load';
      });

    return () => {
      cancelled = true;
      player?.dispose();
      target.replaceChildren();
    };
  });
</script>

{#if !src}
  <div class="terminal-placeholder">
    <span class="status-dot muted"></span>
    stream not provisioned — showing nothing
  </div>
{:else}
  <div class="terminal-frame" class:terminal-live={live}>
    <div bind:this={mount}></div>
    {#if loadError}
      <div class="terminal-error">{loadError}</div>
    {/if}
  </div>
{/if}
