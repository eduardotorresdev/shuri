<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    id: string;
    label: string;
    required?: boolean;
    /** The validation message for this field, from the server's `issues`. */
    error?: string;
    /** Rule text shown under the control, e.g. a length or range limit. */
    hint?: string;
    children: Snippet;
  }

  let { id, label, required = false, error, hint, children }: Props = $props();
</script>

<div class="field">
  <label for={id}>
    {label}
    {#if required}<span class="required" aria-label="obrigatório">*</span>{/if}
  </label>

  {@render children()}

  <!--
    The hint is hidden while an error is showing rather than stacked with it: the error is almost
    always about the rule the hint states, so showing both says the same thing twice.
  -->
  {#if error}
    <p class="error" id="{id}-error">{error}</p>
  {:else if hint}
    <p class="hint shuri-muted" id="{id}-hint">{hint}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: 6px;
  }

  label {
    font-size: 13px;
    font-weight: 600;
  }

  .required {
    color: var(--shuri-danger);
  }

  p {
    margin: 0;
    font-size: 12px;
  }

  .hint {
    color: var(--shuri-text-faint);
  }

  .error {
    color: var(--shuri-danger);
    font-weight: 600;
  }
</style>
