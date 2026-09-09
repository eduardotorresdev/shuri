<script lang="ts">
  import type { TextField } from "@shuri/core";

  interface Props {
    field: TextField;
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

<input
  class="shuri-input"
  type="text"
  {id}
  {disabled}
  required={field.required}
  minlength={field.minLength}
  maxlength={field.maxLength}
  aria-invalid={invalid}
  bind:value
/>
