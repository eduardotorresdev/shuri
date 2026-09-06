<script lang="ts">
  import Button from "./Button.svelte";

  interface Props {
    open: boolean;
    title: string;
    /** What is about to happen, in one sentence, naming the record it happens to. */
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let {
    open,
    title,
    message,
    confirmLabel = "Remover",
    cancelLabel = "Cancelar",
    onconfirm,
    oncancel,
  }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  /**
   * Confirming also closes the dialog, and `close` is what cancelling is reported through — without
   * this the one click would fire both handlers, in that order.
   */
  let confirming = false;

  /**
   * Opened through `showModal()` rather than the `open` attribute, which is what gets the browser's
   * own modality: focus is trapped inside, the page behind is inert, and Escape closes it. `close`
   * covers both that key and a click on the backdrop, so cancelling has one path however it happens.
   */
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="confirm-title"
  onclose={() => {
    if (confirming) confirming = false;
    else oncancel();
  }}
  onclick={(event) => {
    // The backdrop is part of the dialog element, so a click that lands on the element itself and
    // not on the card inside it is a click outside.
    if (event.target === dialog) dialog.close();
  }}
>
  <div class="card">
    <h2 id="confirm-title">{title}</h2>
    <p>{message}</p>
    <div class="actions">
      <Button size="sm" onclick={oncancel}>{cancelLabel}</Button>
      <Button
        size="sm"
        variant="danger-solid"
        onclick={() => {
          confirming = true;
          onconfirm();
        }}
      >
        {confirmLabel}
      </Button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    max-width: 400px;
    width: calc(100% - 32px);
    padding: 0;
    color: var(--shuri-text);
    background: var(--shuri-surface);
    border: 0;
    border-radius: 16px;
    box-shadow: var(--shuri-shadow-modal);
  }

  dialog::backdrop {
    background: rgb(10 10 10 / 35%);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 28px;
  }

  p {
    margin: 0 0 12px;
    font-size: 14px;
    color: var(--shuri-text-muted);
  }

  .actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }
</style>
