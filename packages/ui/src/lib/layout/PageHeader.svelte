<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Crumb } from "./nav.js";

  interface Props {
    title: string;
    description?: string;
    /**
     * The trail above the title, from the index down to this screen. A trail rather than a single
     * "back" link because a record is three levels deep — index, collection, record — and only the
     * middle one is where "back" would go.
     */
    crumbs?: readonly Crumb[];
    /** A short label beside the title, e.g. a global's category. */
    badge?: string;
    /** The screen's actions, e.g. "New record". */
    actions?: Snippet;
  }

  let { title, description, crumbs = [], badge, actions }: Props = $props();
</script>

<header>
  {#if crumbs.length > 0}
    <nav class="crumbs" aria-label="Trilha">
      {#each crumbs as crumb, index (crumb.label + index)}
        {#if index > 0}<span class="sep" aria-hidden="true">›</span>{/if}
        {#if crumb.href}
          <a href={crumb.href}>{crumb.label}</a>
        {:else}
          <span class="here" aria-current="page">{crumb.label}</span>
        {/if}
      {/each}
    </nav>
  {/if}

  <div class="bar">
    <div class="titling">
      <h1>{title}</h1>
      {#if badge}<span class="shuri-badge">{badge}</span>{/if}
    </div>
    {#if actions}
      <div class="shuri-row">{@render actions()}</div>
    {/if}
  </div>

  {#if description}<p class="shuri-muted">{description}</p>{/if}
</header>

<style>
  header {
    margin-bottom: 28px;
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    font-size: 13px;
  }

  .sep {
    color: var(--shuri-text-faint);
  }

  .here {
    color: var(--shuri-text-muted);
  }

  /* `flex-end` so the action button sits on the title's baseline rather than floating above it. */
  .bar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--shuri-gap);
    flex-wrap: wrap;
  }

  .titling {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  p {
    max-width: 70ch;
    margin: 10px 0 0;
  }
</style>
