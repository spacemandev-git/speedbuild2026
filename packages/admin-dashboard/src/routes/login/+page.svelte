<script lang="ts">
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Bureau admin access · The Bureau</title></svelte:head>

<main class="login-shell">
  <section class="login-card">
    <span class="brand-mark">B</span>
    <p class="eyebrow">Restricted access</p>
    <h1>Bureau admin</h1>
    <p>Enter the administrator token to open the operations console.</p>
    {#if form?.invalid}<div class="error-banner">Invalid administrator token.</div>{/if}
    <form method="POST">
      <div class="field">
        <label for="token">Admin token</label>
        <input id="token" name="token" type="password" autocomplete="current-password" required />
      </div>
      <button class="button" type="submit">Open operations console</button>
    </form>
  </section>
</main>
