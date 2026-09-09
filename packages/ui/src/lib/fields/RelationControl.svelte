<script lang="ts">
  import type { RelationField } from "@shuri/core";
  import type { RelationOption } from "./relations.js";

  interface Props {
    field: RelationField;
    id: string;
    value: string | string[];
    /** The referenced collection's records, from `loadRelationOptions`. */
    options?: readonly RelationOption[];
    invalid?: boolean;
    disabled?: boolean;
  }

  let {
    field,
    id,
    value = $bindable(),
    options = [],
    invalid = false,
    disabled = false,
  }: Props = $props();
</script>

<!--
  A relation is a select whose options are records, so it renders as one — the difference from a
  `select` field is where the options came from, not how they are picked.
-->
{#if options.length === 0}
  <p class="shuri-muted empty">
    Nenhum registro em <code class="shuri-mono">{field.collection}</code> para referenciar.
  </p>
{:else if field.multiple}
  <fieldset class="choices" class:invalid {disabled}>
    <legend class="shuri-sr-only">{field.label ?? field.name}</legend>
    {#each options as option (option.value)}
      <label>
        <input type="checkbox" value={option.value} bind:group={value} />
        <span>{option.label}</span>
      </label>
    {/each}
  </fieldset>
{:else}
  <select class="shuri-select" {id} {disabled} aria-invalid={invalid} bind:value>
    <option value="">— selecionar —</option>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
{/if}

<style>
  .empty {
    margin: 0;
    padding: 8px 10px;
    border: 1px dashed var(--shuri-border-strong);
    border-radius: var(--shuri-radius-md);
  }

  .choices {
    display: grid;
    gap: 4px;
    max-height: 220px;
    overflow-y: auto;
    margin: 0;
    padding: 8px;
    border: 1px solid var(--shuri-border-strong);
    border-radius: var(--shuri-radius-md);
    background: var(--shuri-surface);
  }

  .choices.invalid {
    border-color: var(--shuri-danger);
  }

  label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    font-size: 13px;
    border-radius: var(--shuri-radius-md);
    cursor: pointer;
  }

  label:hover {
    background: var(--shuri-surface-alt);
  }

  input {
    width: 16px;
    height: 16px;
    accent-color: var(--shuri-text);
  }
</style>
