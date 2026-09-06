<script lang="ts">
  import type { Field } from "@shuri/core";
  import type { RecordInput } from "@shuri/store";
  import { issuesByField } from "$shared/index.js";
  import FieldControl from "../fields/FieldControl.svelte";
  import type { RelationOptions } from "../fields/relations.js";
  import { fieldLabel, formValues, toRecordInput } from "../fields/values.js";
  import Button from "../ui/Button.svelte";
  import FormField from "../ui/FormField.svelte";
  import IssueSummary from "./IssueSummary.svelte";

  interface Props {
    /** The fields to generate the form from — a collection's or a global's, already filtered by the server. */
    fields: readonly Field[];
    /** The record being edited; absent when creating. */
    record?: RecordInput;
    relationOptions?: RelationOptions;
    submitLabel?: string;
    /** Where "Cancelar" goes. Omitted for a global, which has nowhere to go back to. */
    cancelHref?: string;
    /**
     * Offers "Remover" at the far end of the same row. Here rather than beside the page title
     * because deleting is one of the things you can do to the record you are editing, and the row
     * of actions under the form is where the others already are — set apart, so it is never the
     * button next to the one you meant.
     */
    ondelete?: () => void;
    /** Receives the body to write. Throwing from it shows the error, including per-field issues. */
    onsubmit: (input: RecordInput) => Promise<void>;
  }

  let {
    fields,
    record,
    relationOptions = {},
    submitLabel = "Salvar",
    cancelHref,
    ondelete,
    onsubmit,
  }: Props = $props();

  /**
   * Seeded from `record` rather than derived from it: this is what the author is typing into, so it
   * has to survive every re-render that isn't a move to a different record. `$state.snapshot` is not
   * needed on read — `toRecordInput` copies the values it keeps.
   */
  // svelte-ignore state_referenced_locally
  let values = $state(formValues(fields, record));
  let saving = $state(false);
  let error = $state<unknown>(undefined);

  const fieldErrors = $derived(issuesByField(error));

  /**
   * The rule text shown under a control, from the limits the field declares.
   * @param field - The field being rendered.
   * @returns The hint, or `undefined` when the field declares no limit worth stating.
   */
  function hintOf(field: Field): string | undefined {
    if (field.type === "text" || field.type === "textarea") {
      if (field.maxLength !== undefined) return `Até ${field.maxLength} caracteres.`;
      return undefined;
    }
    if (field.type === "number") {
      const kind = field.kind === "integer" ? "Número inteiro" : "Número decimal";
      // Each bound is stated on its own, so a field with only a `max` still says what it is.
      const low = field.sign === "positive" ? Math.max(field.min ?? 0, 0) : field.min;
      const high = field.sign === "negative" ? Math.min(field.max ?? 0, 0) : field.max;
      const bounds = [
        low === undefined ? undefined : `a partir de ${low}`,
        high === undefined ? undefined : `até ${high}`,
      ].filter(Boolean);
      return bounds.length > 0 ? `${kind}, ${bounds.join(" ")}.` : `${kind}.`;
    }
    return undefined;
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    saving = true;
    error = undefined;
    try {
      await onsubmit(toRecordInput(fields, values));
    } catch (caught) {
      error = caught;
    } finally {
      saving = false;
    }
  }
</script>

<form onsubmit={handleSubmit} novalidate>
  {#if error}
    <IssueSummary {error} />
  {/if}

  {#each fields as field (field.name)}
    <FormField
      id="field-{field.name}"
      label={fieldLabel(field)}
      required={field.required}
      error={fieldErrors[field.name]}
      hint={hintOf(field)}
    >
      <FieldControl
        {field}
        id="field-{field.name}"
        {relationOptions}
        invalid={fieldErrors[field.name] !== undefined}
        disabled={saving}
        bind:value={values[field.name]}
      />
    </FormField>
  {/each}

  <div class="actions">
    <Button type="submit" variant="primary" disabled={saving}>
      {saving ? "Salvando…" : submitLabel}
    </Button>
    {#if cancelHref}
      <Button href={cancelHref}>Cancelar</Button>
    {/if}
    {#if ondelete}
      <div class="destructive">
        <Button variant="danger" disabled={saving} onclick={ondelete}>Remover</Button>
      </div>
    {/if}
  </div>
</form>

<style>
  /*
   * No card around it: the inputs are the white surfaces on this screen, and a card behind them
   * would be white paper on white paper with a form somewhere inside.
   */
  form {
    display: grid;
    gap: 20px;
    width: 100%;
    max-width: 780px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
  }

  .destructive {
    margin-left: auto;
  }
</style>
