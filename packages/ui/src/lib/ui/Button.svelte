<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /**
     * `primary` for the one action a screen exists for, `danger` for a destructive one it offers on
     * the side, and `danger-solid` for a destructive action that _is_ the point — the confirm button
     * of a dialog that exists to ask about it.
     */
    variant?: "default" | "primary" | "danger" | "danger-solid" | "ghost";
    /** `sm` for a button inside a card or a toolbar, where the page's own actions are elsewhere. */
    size?: "md" | "sm";
    type?: "button" | "submit";
    disabled?: boolean;
    /** Renders as a link when set, so navigation stays a real anchor the browser can open in a tab. */
    href?: string;
    title?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = "default",
    size = "md",
    type = "button",
    disabled = false,
    href,
    title,
    onclick,
    children,
  }: Props = $props();
</script>

{#if href}
  <a class="btn {variant} {size}" class:disabled {href} {title}>{@render children()}</a>
{:else}
  <button class="btn {variant} {size}" {type} {disabled} {title} {onclick}
    >{@render children()}</button
  >
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 22px;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--shuri-text);
    background: transparent;
    border: 1px solid var(--shuri-border-strong);
    border-radius: var(--shuri-radius-md);
    cursor: pointer;
    transition:
      background 0.18s var(--shuri-ease),
      border-color 0.18s var(--shuri-ease),
      color 0.18s var(--shuri-ease);
  }

  .sm {
    padding: 9px 14px;
    font-size: 13px;
  }

  .btn:hover:not(.disabled, :disabled) {
    color: var(--shuri-text);
    border-color: var(--shuri-text);
  }

  /* Ink, not accent: the four theme colours are decoration, and the main action is the page itself. */
  .primary {
    color: var(--shuri-panel);
    background: var(--shuri-text);
    border-color: var(--shuri-text);
  }

  .primary:hover:not(.disabled, :disabled) {
    color: var(--shuri-panel);
    background: #2b2b2b;
    border-color: #2b2b2b;
  }

  .danger {
    color: var(--shuri-danger-deep);
    border-color: var(--shuri-danger-soft);
  }

  .danger:hover:not(.disabled, :disabled) {
    color: var(--shuri-danger-deep);
    background: var(--shuri-danger-soft);
    border-color: var(--shuri-danger);
  }

  .danger-solid {
    color: #fff;
    background: var(--shuri-danger);
    border-color: var(--shuri-danger);
  }

  .danger-solid:hover:not(.disabled, :disabled) {
    color: #fff;
    background: var(--shuri-danger-deep);
    border-color: var(--shuri-danger-deep);
  }

  .ghost {
    border-color: transparent;
  }

  .ghost:hover:not(.disabled, :disabled) {
    background: var(--shuri-hover);
    border-color: transparent;
  }

  .btn:disabled,
  .disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
