<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    description?: string;
    /** The action that resolves the emptiness, e.g. "create the first record". */
    action?: Snippet;
  }

  let { title, description, action }: Props = $props();
</script>

<div class="empty">
  <h2>{title}</h2>
  {#if description}<p class="shuri-muted">{description}</p>{/if}
  {#if action}<div class="act">{@render action()}</div>{/if}
</div>

<style>
  .empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 56px 24px;
    text-align: center;
  }

  h2 {
    font-size: 17px;
    font-weight: 600;
  }

  p {
    max-width: 46ch;
    margin: 0;
    font-size: 13px;
  }

  .act {
    margin-top: 6px;
  }
</style>
