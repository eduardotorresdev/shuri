<script lang="ts">
  import type { TextareaField } from "@shuri/core";

  interface Props {
    field: TextareaField;
    id: string;
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
</script>

<textarea
  class="shuri-textarea"
  {id}
  {disabled}
  required={field.required}
  minlength={field.minLength}
  maxlength={field.maxLength}
  aria-invalid={invalid}
  bind:value></textarea>
