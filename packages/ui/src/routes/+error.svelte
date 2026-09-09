<script lang="ts">
  import { page } from "$app/state";
  import Alert from "$lib/ui/Alert.svelte";
</script>

<!--
  The layout's own load can fail (the app is down, or the admin is mounted at a path the bundle
  wasn't built for), in which case there is no schema and no sidebar — so this page stands alone
  rather than assuming the shell around it.
-->
<div class="wrap">
  <div class="card">
    <span class="status">{page.status}</span>
    <Alert tone="error">{page.error?.message ?? "Algo deu errado."}</Alert>
  </div>
</div>

<style>
  .wrap {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: 24px;
    background: var(--shuri-bg);
  }

  .card {
    display: grid;
    gap: 16px;
    width: 100%;
    max-width: 420px;
    padding: 40px;
    background: var(--shuri-surface);
    border-radius: 16px;
    box-shadow: 0 12px 40px rgb(10 10 10 / 8%);
  }

  .status {
    font-size: 44px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
  }
</style>
