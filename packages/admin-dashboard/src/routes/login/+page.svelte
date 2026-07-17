<script lang="ts">
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Executor access · The Estate</title></svelte:head>

<main class="login-shell">
  <section class="login-card">
    <span class="brand-mark">E</span>
    <p class="eyebrow">Restricted instrument</p>
    <h1>Executor access</h1>
    <p>Present the administrator token. Every action beyond this point becomes part of the estate record.</p>
    {#if form?.invalid}<div class="error-banner">The estate does not recognise that credential.</div>{/if}
    <form method="POST">
      <div class="field">
        <label for="token">Admin token</label>
        <input id="token" name="token" type="password" autocomplete="current-password" required />
      </div>
      <button class="button" type="submit">Unseal operations console</button>
    </form>
  </section>
</main>
