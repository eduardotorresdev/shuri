<script lang="ts">
  import type { BooleanField } from "@shuri/core";

  interface Props {
    field: BooleanField;
    id: string;
    value: boolean;
    invalid?: boolean;
    disabled?: boolean;
  }

  let { field, id, value = $bindable(), disabled = false }: Props = $props();
</script>

<!--
  Still a checkbox, drawn as a switch: `appearance: none` takes the browser's box away and leaves
  everything else — the label's `for`, the space bar, the checked state a screen reader reads out.
  A `<div role="switch">` would have to reimplement all of it.

  Just the control: the surrounding `FormField` already renders the label.
-->
<input
  class="switch"
  type="checkbox"
  {id}
  {disabled}
  required={field.required}
  bind:checked={value}
/>

<style>
  .switch {
    appearance: none;
    position: relative;
    width: 38px;
    height: 22px;
    margin: 3px 0;
    background: var(--shuri-border-strong);
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s var(--shuri-ease);
  }

  .switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    background: var(--shuri-surface);
    border-radius: 50%;
    box-shadow: 0 1px 3px rgb(10 10 10 / 30%);
    transition: left 0.15s var(--shuri-ease);
  }

  .switch:checked {
    background: var(--shuri-text);
  }

  .switch:checked::after {
    left: 19px;
  }

  .switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
