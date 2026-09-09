<script lang="ts">
  import type { Field } from "@shuri/core";
  import BooleanControl from "./BooleanControl.svelte";
  import EmailControl from "./EmailControl.svelte";
  import NumberControl from "./NumberControl.svelte";
  import RelationControl from "./RelationControl.svelte";
  import SelectControl from "./SelectControl.svelte";
  import TextControl from "./TextControl.svelte";
  import TextareaControl from "./TextareaControl.svelte";
  import type { RelationOptions } from "./relations.js";

  interface Props {
    field: Field;
    id: string;
    value: unknown;
    /** Options for every relation field of the form, keyed by referenced collection. */
    relationOptions?: RelationOptions;
    invalid?: boolean;
    disabled?: boolean;
  }

  let {
    field,
    id,
    value = $bindable(),
    relationOptions = {},
    invalid = false,
    disabled = false,
  }: Props = $props();
</script>

<!--
  The one place a field's `type` becomes a control. Every screen goes through here, so supporting a
  new field type added to `@shuri/core` is a branch in this file and a component beside it — nothing
  else in the admin knows the type union exists.

  The `as never` casts narrow `value` per branch: `field` is narrowed by the switch, but the state
  it is bound to is a single `unknown` slot in the form's record, and Svelte's `bind:` cannot carry
  that narrowing across the boundary.
-->
{#if field.type === "text"}
  <TextControl {field} {id} {invalid} {disabled} bind:value={value as never} />
{:else if field.type === "textarea"}
  <TextareaControl {field} {id} {invalid} {disabled} bind:value={value as never} />
{:else if field.type === "email"}
  <EmailControl {field} {id} {invalid} {disabled} bind:value={value as never} />
{:else if field.type === "number"}
  <NumberControl {field} {id} {invalid} {disabled} bind:value={value as never} />
{:else if field.type === "boolean"}
  <BooleanControl {field} {id} {invalid} {disabled} bind:value={value as never} />
{:else if field.type === "select"}
  <SelectControl {field} {id} {invalid} {disabled} bind:value={value as never} />
{:else if field.type === "relation"}
  <RelationControl
    {field}
    {id}
    {invalid}
    {disabled}
    options={relationOptions[field.collection]}
    bind:value={value as never}
  />
{/if}
