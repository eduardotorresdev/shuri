<script lang="ts">
  import type { AdminUser } from "$shared/schema.js";
  import Icon from "../ui/Icon.svelte";

  interface Props {
    user: AdminUser;
    /** Matches the sidebar it sits in: the card narrows to the avatar and the menu opens sideways. */
    collapsed?: boolean;
    onsignout: () => Promise<void>;
  }

  let { user, collapsed = false, onsignout }: Props = $props();

  let open = $state(false);
  let signingOut = $state(false);
  let root = $state<HTMLDivElement>();

  const name = $derived(user.name ?? user.email);
  const initial = $derived(name.trim().charAt(0).toUpperCase());

  /**
   * A menu that opens on click has to close on a click anywhere else, including inside the page it
   * overlaps. Listening on the window while open — and only while open — is the one place that
   * catches every such click without every other element having to know the menu exists.
   */
  $effect(() => {
    if (!open) return;

    const close = (event: MouseEvent): void => {
      if (!root?.contains(event.target as Node)) open = false;
    };
    globalThis.addEventListener("click", close);
    return () => globalThis.removeEventListener("click", close);
  });

  async function signOut(): Promise<void> {
    signingOut = true;
    try {
      await onsignout();
    } finally {
      signingOut = false;
      open = false;
    }
  }
</script>

<div class="menu" class:collapsed bind:this={root}>
  {#if open}
    <div class="pop">
      <button type="button" class="item out" disabled={signingOut} onclick={signOut}>
        {signingOut ? "Saindo…" : "Sair"}
      </button>
    </div>
  {/if}

  <button
    type="button"
    class="card"
    aria-expanded={open}
    aria-haspopup="menu"
    title={user.email}
    onclick={() => (open = !open)}
  >
    <span class="avatar" aria-hidden="true">{initial}</span>
    <span class="clip">
      <span class="who">
        <span class="lines">
          <span class="name">{name}</span>
          <span class="mail">{user.email}</span>
        </span>
        <Icon name={open ? "chevronDown" : "chevronUp"} size={13} />
      </span>
    </span>
  </button>
</div>

<style>
  .menu {
    position: relative;
  }

  .card {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 10px 12px;
    font: inherit;
    text-align: left;
    color: var(--shuri-text);
    background: var(--shuri-surface);
    border: 0;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgb(10 10 10 / 6%);
    cursor: pointer;
    transition:
      padding 0.32s var(--shuri-ease-spring),
      box-shadow 0.18s ease;
  }

  .card:hover {
    box-shadow: 0 4px 14px rgb(10 10 10 / 10%);
  }

  .collapsed .card {
    padding: 10px;
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    background: var(--shuri-accent);
    border-radius: 50%;
  }

  .clip {
    display: grid;
    grid-template-columns: 1fr;
    flex: 1;
    min-width: 0;
    opacity: 1;
    transition: opacity 0.3s ease;
  }

  .collapsed .clip {
    opacity: 0;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 10px;
    overflow: hidden;
  }

  .lines {
    display: grid;
    flex: 1;
    min-width: 0;
  }

  .name,
  .mail {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .name {
    font-size: 13px;
    font-weight: 600;
  }

  .mail {
    font-size: 11px;
    color: var(--shuri-text-muted);
  }

  /*
   * Opens upwards, because the card is the last thing in the sidebar and there is nothing below it.
   * Collapsed there is no width to open into either, so it swings out to the side instead.
   */
  .pop {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 0;
    right: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    background: var(--shuri-surface);
    border-radius: 12px;
    box-shadow: var(--shuri-shadow-pop);
  }

  .pop::before {
    content: "";
    position: absolute;
    top: 100%;
    left: 24px;
    border: 6px solid transparent;
    border-top-color: var(--shuri-surface);
  }

  .collapsed .pop {
    left: calc(100% + 12px);
    right: auto;
    bottom: 0;
    width: 190px;
  }

  .collapsed .pop::before {
    top: auto;
    bottom: 20px;
    left: auto;
    right: 100%;
    border-top-color: transparent;
    border-right-color: var(--shuri-surface);
  }

  .item {
    padding: 9px 12px;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    color: var(--shuri-text);
    background: none;
    border: 0;
    border-radius: var(--shuri-radius-sm);
    cursor: pointer;
  }

  .out {
    color: var(--shuri-danger-deep);
  }

  .out:hover:not(:disabled) {
    background: var(--shuri-danger-soft);
  }

  .item:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* The card sits at the top of the page in the band layout, so the menu has to drop downwards. */
  @media (max-width: 860px) {
    .pop,
    .collapsed .pop {
      top: calc(100% + 10px);
      bottom: auto;
      left: auto;
      right: 0;
      width: 190px;
    }

    .pop::before,
    .collapsed .pop::before {
      display: none;
    }
  }
</style>
