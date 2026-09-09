<script lang="ts">
  import type { SelectField } from "@shuri/core";

  interface Props {
    field: SelectField;
    id: string;
    value: string | string[];
    invalid?: boolean;
    disabled?: boolean;
  }

  let {
    field,
    id,
    value = $bindable(),
    invalid = false,
    disabled = false,
  }: Props = $props();
</script>

{#if field.multiple}
  <!--
    A checkbox list rather than a multi-select: selecting several options in a native `<select
    multiple>` needs a modifier key nobody discovers, and one mis-click clears the whole selection.
  -->
  <fieldset class="choices" class:invalid {disabled}>
    <legend class="shuri-sr-only">{field.label ?? field.name}</legend>
    {#each field.options as option (option.value)}
      <label>
        <input type="checkbox" value={option.value} bind:group={value} />
        <span>{option.label}</span>
      </label>
    {/each}
  </fieldset>
{:else}
  <select class="shuri-select" {id} {disabled} aria-invalid={invalid} bind:value>
    <!-- Present whether or not the field is required: an optional select needs a way back to unset. -->
    <option value="">— selecionar —</option>
    {#each field.options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
{/if}

<style>
  .choices {
    display: grid;
    gap: 4px;
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
