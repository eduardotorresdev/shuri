<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AdminSchema } from "$shared/schema.js";
  import Icon from "../ui/Icon.svelte";
  import { navGroups } from "./nav.js";
  import SideNav from "./SideNav.svelte";

  interface Props {
    schema: AdminSchema;
    /** The current path, used to highlight the open entry. */
    pathname: string;
    /**
     * Rendered at the foot of the sidebar — the user card, when the admin has auth. Receives whether
     * the sidebar is collapsed, because whatever goes there has to narrow with it.
     */
    actions?: Snippet<[boolean]>;
    children: Snippet;
  }

  let { schema, pathname, actions, children }: Props = $props();

  const groups = $derived(navGroups(schema));
  /** The brand mark: the app's own initial, so an admin looks like the app it administers. */
  const initial = $derived(schema.title.trim().charAt(0).toUpperCase() || "S");

  let collapsed = $state(false);
</script>

<!--
  Cream page, and the working area is a rounded panel floating on it. The panel — not the page — is
  what scrolls, so the sidebar and the brand stay put however long a list gets.
-->
<div class="shell">
  <aside class="side" class:collapsed>
    <div class="side-head">
      <a class="mark" href={schema.basePath} aria-label={schema.title}>{initial}</a>
      <div class="clip">
        <a class="brand" href={schema.basePath}>{schema.title}</a>
      </div>
    </div>

    <SideNav
      home={{ label: "Página Inicial", href: schema.basePath, icon: "home" }}
      {groups}
      {pathname}
      {collapsed}
    />

    {#if actions}
      <div class="side-foot">{@render actions(collapsed)}</div>
    {/if}
  </aside>

  <div class="stage">
    <button
      class="side-toggle"
      type="button"
      aria-expanded={!collapsed}
      title={collapsed ? "Expandir o menu" : "Recolher o menu"}
      onclick={() => (collapsed = !collapsed)}
    >
      <span class="shuri-sr-only">
        {collapsed ? "Expandir o menu" : "Recolher o menu"}
      </span>
      <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={13} />
    </button>

    <main>
      <div class="page">
        {@render children()}
      </div>
    </main>
  </div>
</div>

<style>
  .shell {
    display: flex;
    /* `dvh`, not `vh`: a mobile browser's collapsing address bar would otherwise leave a strip of
       cream under the panel and make the page itself scroll behind it. */
    height: 100dvh;
    overflow: hidden;
  }

  .side {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: var(--shuri-sidebar);
    padding: 26px 10px 22px;
    transition: width 0.32s var(--shuri-ease-spring);
  }

  .side.collapsed {
    width: var(--shuri-sidebar-collapsed);
  }

  .side-head {
    display: flex;
    align-items: center;
    padding: 0 8px;
    margin-bottom: 26px;
    transition: padding 0.32s var(--shuri-ease-spring);
  }

  .side.collapsed .side-head {
    padding-left: 11px;
  }

  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    font-size: 16px;
    font-weight: 700;
    color: var(--shuri-c1);
    background: var(--shuri-text);
    border-radius: 9px;
  }

  .mark:hover {
    color: var(--shuri-c1);
  }

  .brand {
    display: block;
    padding-left: 10px;
    font-size: 19px;
    font-weight: 700;
    color: var(--shuri-text);
  }

  /*
   * Collapsing is a width animation, so the labels have to go somewhere the moment there is no room
   * for them. A one-column grid whose child is `overflow: hidden` lets the text be clipped by the
   * shrinking column instead of wrapping inside it, which is what would make the rows jump.
   */
  .clip {
    display: grid;
    grid-template-columns: 1fr;
    flex: 1;
    opacity: 1;
    transition: opacity 0.3s ease;
  }

  .clip > * {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .side.collapsed .clip {
    opacity: 0;
  }

  .side-foot {
    margin-top: 18px;
  }

  .stage {
    display: flex;
    flex: 1;
    position: relative;
    min-width: 0;
    margin: 3vh 3vh 3vh 0;
  }

  /* Sits on the seam between the cream and the panel, which is the only place it reads as a hinge. */
  .side-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 18px;
    left: -13px;
    z-index: 10;
    width: 26px;
    height: 26px;
    color: var(--shuri-text);
    background: #ddd8cf;
    border: 0;
    border-radius: var(--shuri-radius-sm);
    cursor: pointer;
    transition: background 0.18s var(--shuri-ease);
  }

  .side-toggle:hover {
    background: #d0cabf;
  }

  main {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--shuri-panel);
    border-radius: var(--shuri-radius-lg);
  }

  .page {
    width: 100%;
    max-width: 1440px;
    padding: 28px 34px 40px;
  }

  /*
   * Under about a tablet the two columns stop fitting side by side, so the sidebar becomes a band
   * across the top: same rows, laid out horizontally, and the toggle is gone because there is no
   * width left to reclaim.
   */
  @media (max-width: 860px) {
    .shell {
      flex-direction: column;
      height: auto;
      min-height: 100dvh;
      overflow: visible;
    }

    .side,
    .side.collapsed {
      width: 100%;
      padding: 18px 16px 8px;
    }

    .side-head {
      margin-bottom: 16px;
    }

    .stage {
      margin: 0 12px 12px;
    }

    .side-toggle {
      display: none;
    }

    main {
      overflow: visible;
    }

    .page {
      padding: 20px 18px 32px;
    }
  }
</style>
