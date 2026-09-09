<script lang="ts">
  import type { EmailField } from "@shuri/core";

  interface Props {
    field: EmailField;
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

<!-- `type="email"` for the mobile keyboard and the browser's own hint; the store validates it again. -->
<input
  class="shuri-input"
  type="email"
  autocomplete="email"
  {id}
  {disabled}
  required={field.required}
  aria-invalid={invalid}
  bind:value
/>
