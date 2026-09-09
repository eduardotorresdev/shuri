<script lang="ts">
  import Icon from "../ui/Icon.svelte";

  interface Props {
    offset: number;
    limit: number;
    /** How many records the current page holds — the page is the last one when it isn't full. */
    count: number;
    /** True when the server had at least one more record than this page shows. */
    hasMore: boolean;
    onchange: (offset: number) => void;
  }

  let { offset, limit, count, hasMore, onchange }: Props = $props();

  const first = $derived(count === 0 ? 0 : offset + 1);
  const last = $derived(offset + count);
</script>

<!--
  Offsets and a "has more" flag rather than page numbers: the list route asks for one record beyond
  the page to learn whether a next page exists, because the REST list route answers with records
  only — there is no total to divide into pages.
-->
<div class="pager">
  <span class="range">
    {#if count === 0}Nenhum registro{:else}{first}–{last}{/if}
  </span>
  <div class="steps">
    <button
      type="button"
      disabled={offset === 0}
      title="Página anterior"
      onclick={() => onchange(Math.max(0, offset - limit))}
    >
      <span class="shuri-sr-only">Página anterior</span>
      <Icon name="chevronLeft" size={13} />
    </button>
    <button
      type="button"
      disabled={!hasMore}
      title="Próxima página"
      onclick={() => onchange(offset + limit)}
    >
      <span class="shuri-sr-only">Próxima página</span>
      <Icon name="chevronRight" size={13} />
    </button>
  </div>
</div>

<style>
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--shuri-gap);
    padding: 12px 20px;
  }

  .range {
    font-size: 12px;
    color: var(--shuri-text-muted);
  }

  .steps {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    color: var(--shuri-text);
    background: var(--shuri-surface);
    border: 1px solid rgb(10 10 10 / 15%);
    border-radius: var(--shuri-radius-sm);
    cursor: pointer;
    transition: border-color 0.18s var(--shuri-ease);
  }

  button:hover:not(:disabled) {
    border-color: var(--shuri-text);
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
