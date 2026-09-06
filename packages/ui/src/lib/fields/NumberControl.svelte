<script lang="ts">
  import type { NumberField } from "@shuri/core";

  interface Props {
    field: NumberField;
    id: string;
    /**
     * Held as a string, not a number: `bind:value` on a `type="number"` input gives `undefined` for
     * anything the browser can't parse, which erases the digits already typed the moment a `-` or a
     * `.` is entered. `toRecordInput` does the conversion once, on submit.
     */
    value: string;
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

  /** `sign` narrows the range the field already declares, so the tighter of the two bounds wins. */
  const min = $derived(
    field.sign === "positive" ? Math.max(field.min ?? 0, 0) : field.min,
  );
  const max = $derived(
    field.sign === "negative" ? Math.min(field.max ?? 0, 0) : field.max,
  );
</script>

<input
  class="shuri-input"
  type="number"
  inputmode={field.kind === "integer" ? "numeric" : "decimal"}
  step={field.kind === "integer" ? 1 : "any"}
  {id}
  {min}
  {max}
  {disabled}
  required={field.required}
  aria-invalid={invalid}
  bind:value
/>
