<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const navigation = [
    { href: '/', label: 'Overview' },
    { href: '/participants', label: 'Operatives' },
    { href: '/live', label: 'Live wall' },
    { href: '/challenges', label: 'Rooms' },
    { href: '/recordings', label: 'Recordings' }
  ];

  function active(href: string): boolean {
    return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
  }
</script>

<svelte:head>
  <title>The Bureau · Operations</title>
  <meta name="description" content="Speed Build Bureau operations console" />
</svelte:head>

{#if page.url.pathname === '/login'}
  {@render children()}
{:else}
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/">
        <span class="brand-mark">B</span>
        <span><strong>THE BUREAU</strong><small>operations</small></span>
      </a>
      <nav aria-label="Primary navigation">
        {#each navigation as item (item.href)}
          <a href={item.href} class:active={active(item.href)}>{item.label}</a>
        {/each}
      </nav>
      <form method="POST" action="/logout">
        <button class="button ghost small" type="submit">Lock console</button>
      </form>
    </header>
    <main class="page-shell">{@render children()}</main>
  </div>
{/if}
