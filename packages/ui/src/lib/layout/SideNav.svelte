<script lang="ts">
  import Icon from "../ui/Icon.svelte";
  import { isActive, type NavGroup, type NavItem } from "./nav.js";

  interface Props {
    /** The entry above the groups — the index, which belongs to no group. */
    home: NavItem;
    groups: readonly NavGroup[];
    pathname: string;
    /** Narrowed to icons only, with the labels shown as tooltips instead. */
    collapsed?: boolean;
  }

  let { home, groups, pathname, collapsed = false }: Props = $props();
</script>

<nav class="side-secs" class:collapsed aria-label="Seções">
  {#snippet row(item: NavItem, active: boolean)}
    <!--
      The tooltip is rendered for every row and revealed only while the sidebar is collapsed: it is
      the label, moved, so a narrowed sidebar is still navigable without hovering blind.
    -->
    <a
      class="nav-row"
      class:active
      href={item.href}
      aria-current={active ? "page" : undefined}
    >
      <span class="nav-ico"><Icon name={item.icon} size={15} /></span>
      <span class="clip"><span class="nav-txt">{item.label}</span></span>
      <span class="nav-tip">{item.label}</span>
    </a>
  {/snippet}

  {@render row(home, pathname === home.href)}

  {#each groups as group (group.title)}
    <section>
      <div class="clip-v">
        <h2 class="shuri-eyebrow">{group.title}</h2>
      </div>
      {#each group.items as item (item.href)}
        {@render row(item, isActive(item.href, pathname))}
      {/each}
    </section>
  {/each}
</nav>

<style>
  .side-secs {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 20px;
    overflow-x: hidden;
    overflow-y: auto;
    transition: gap 0.32s var(--shuri-ease-spring);
  }

  /*
   * The tooltips have to escape the scroll box to be visible, and once the labels are gone there is
   * nothing left to scroll horizontally anyway.
   */
  .side-secs.collapsed {
    gap: 6px;
    overflow: visible;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h2 {
    padding: 0 12px;
    font-size: 10px;
  }

  /*
   * The vertical twin of `.clip`: a group title collapses to nothing by animating its row from
   * `1fr` to `0fr`, which is a height animation that needs no measured pixel value.
   */
  .clip-v {
    display: grid;
    grid-template-rows: 1fr;
    margin-bottom: 6px;
    opacity: 1;
    transition:
      grid-template-rows 0.32s var(--shuri-ease-spring),
      margin 0.32s var(--shuri-ease-spring),
      opacity 0.3s ease;
  }

  .clip-v > * {
    min-height: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .collapsed .clip-v {
    grid-template-rows: 0fr;
    margin-bottom: 0;
    opacity: 0;
  }

  .clip {
    display: grid;
    grid-template-columns: 1fr;
    flex: 1;
    opacity: 1;
    transition: opacity 0.3s ease;
  }

  .clip > * {
    display: block;
    min-width: 0;
    padding-left: 10px;
    overflow: hidden;
    white-space: nowrap;
  }

  .collapsed .clip {
    opacity: 0;
  }

  .nav-row {
    display: flex;
    position: relative;
    align-items: center;
    padding: 9px 12px;
    font-size: 14px;
    font-weight: 400;
    color: var(--shuri-text);
    border-radius: var(--shuri-radius-md);
    transition:
      background 0.18s var(--shuri-ease),
      padding 0.32s var(--shuri-ease-spring);
  }

  .collapsed .nav-row {
    padding-left: 18px;
  }

  /* The open entry is a white card on the cream — the same paper the panel beside it is made of. */
  .nav-row.active {
    font-weight: 600;
    background: var(--shuri-surface);
  }

  .nav-row:not(.active):hover {
    background: var(--shuri-hover);
  }

  .nav-ico {
    color: var(--shuri-c3);
    transition: color 0.18s var(--shuri-ease);
  }

  .nav-txt {
    transition: padding-left 0.18s var(--shuri-ease);
  }

  .nav-row:not(.active):hover .nav-ico {
    color: var(--shuri-text);
  }

  .nav-row:not(.active):hover .nav-txt {
    padding-left: 6px;
  }

  .nav-tip {
    position: absolute;
    left: calc(100% + 12px);
    top: 50%;
    z-index: 30;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--shuri-panel);
    background: var(--shuri-text);
    border-radius: var(--shuri-radius-sm);
    opacity: 0;
    transform: translateY(-50%) translateX(-4px);
    pointer-events: none;
    transition:
      opacity 0.15s var(--shuri-ease),
      transform 0.15s var(--shuri-ease);
  }

  .nav-tip::before {
    content: "";
    position: absolute;
    right: 100%;
    top: 50%;
    border: 5px solid transparent;
    border-right-color: var(--shuri-text);
    transform: translateY(-50%);
  }

  .collapsed .nav-row:hover .nav-tip,
  .collapsed .nav-row:focus-visible .nav-tip {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }

  /* Laid out as a band above the panel, the groups run across instead of down. */
  @media (max-width: 860px) {
    .side-secs,
    .side-secs.collapsed {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 16px;
      overflow: visible;
    }

    section {
      flex-direction: row;
      align-items: center;
      gap: 4px;
    }

    .clip-v,
    .side-secs.collapsed .clip-v {
      grid-template-rows: 1fr;
      margin: 0;
      opacity: 1;
    }

    .clip,
    .side-secs.collapsed .clip {
      opacity: 1;
    }

    .nav-tip {
      display: none;
    }
  }
</style>
