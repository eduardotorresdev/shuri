<script lang="ts">
  import type { Field } from "@shuri/core";
  import type { RelationOption } from "../fields/relations.js";

  interface Props {
    field: Field;
    id: string;
    /** The control's form name, from `filterName(field)` — how the submitted form is read back. */
    name: string;
    /** The value currently applied to the list, `""` when the field isn't being filtered. */
    value: string;
    /** The referenced collection's records, for a relation field. */
    options?: readonly RelationOption[];
  }

  let { field, id, name, value, options = [] }: Props = $props();
</script>

<!--
  The filter twin of `FieldControl`, and deliberately not that component: the two disagree on
  everything a control does outside a form. A filter is never required and never invalid, a boolean
  needs three states rather than a checkbox's two — "todos" is not "não" — and a value the author
  hasn't reached for yet has to be `""` so that it reads as "no filter" rather than as a value.

  Uncontrolled, too: `value` is the applied filter the control starts from, and what the author types
  next lives in the DOM until the form is submitted. There is no draft state to keep in sync, and no
  navigation — sorting, paging — can reset a half-typed filter behind their back.
-->
{#if field.type === "number"}
  <input
    class="shuri-input"
    type="number"
    inputmode={field.kind === "integer" ? "numeric" : "decimal"}
    step={field.kind === "integer" ? 1 : "any"}
    {id}
    {name}
    {value}
  />
{:else if field.type === "boolean"}
  <select class="shuri-select" {id} {name} {value}>
    <option value="">Todos</option>
    <option value="true">Sim</option>
    <option value="false">Não</option>
  </select>
{:else if field.type === "select"}
  <select class="shuri-select" {id} {name} {value}>
    <option value="">Todos</option>
    {#each field.options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
{:else if field.type === "relation"}
  <select class="shuri-select" {id} {name} {value} disabled={options.length === 0}>
    <option value="">Todos</option>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
{:else}
  <!--
    `type="search"` rather than `text`: the browser draws its own clear button, and this is a search
    box in every sense the author cares about.
  -->
  <input class="shuri-input" type="search" {id} {name} {value} />
{/if}
