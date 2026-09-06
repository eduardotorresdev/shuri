<script lang="ts">
  import { AdminRequestError } from "$shared/index.js";
  import Alert from "../ui/Alert.svelte";

  interface Props {
    error: unknown;
  }

  let { error }: Props = $props();

  const message = $derived(error instanceof Error ? error.message : String(error));
  /**
   * Only issues whose field the form does not show get listed here — the rest are already rendered
   * against their own input, and repeating them turns one problem into two lines to read.
   */
  const issues = $derived(error instanceof AdminRequestError ? error.issues : []);
</script>

<Alert tone="error">
  <strong>{message}</strong>
  {#if issues.length > 1}
    <ul>
      {#each issues as issue (issue.path + issue.message)}
        <li><code class="shuri-mono">{issue.path}</code> — {issue.message}</li>
      {/each}
    </ul>
  {/if}
</Alert>

<style>
  ul {
    margin: 6px 0 0;
    padding-left: 20px;
  }
</style>
