<script lang="ts">
  import type { Field } from "@shuri/core";
  import { fieldLabel, type RelationLabels } from "../fields/values.js";
  import type { RelationOption, RelationOptions } from "../fields/relations.js";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import FormField from "../ui/FormField.svelte";
  import FilterControl from "./FilterControl.svelte";
  import {
    describeFilter,
    filterName,
    filterOps,
    formFilters,
    OP_LABELS,
    opName,
    type ListFilters,
  } from "./filters.js";

  interface Props {
    /** The collection's filterable fields, from `filterFields`. */
    fields: readonly Field[];
    /** The filters the list on screen was read with — the URL's, not the panel's. */
    filters: ListFilters;
    /** Options for every relation field, so a relation filter is picked by name. */
    relationOptions?: RelationOptions;
    /** `id -> label` per referenced collection, so an applied relation filter reads as a name. */
    relationLabels?: RelationLabels;
    /** Hands back the whole set of filters to apply; the list turns them into a URL. */
    onapply: (filters: ListFilters) => void;
  }

  let {
    fields,
    filters,
    relationOptions = {},
    relationLabels = {},
    onapply,
  }: Props = $props();

  /**
   * Collapsed by default, applied filters or not: the chips beside the toggle already say what the
   * list is showing, and a panel of twenty controls opening on arrival would push the records off
   * the screen the author came for.
   */
  let open = $state(false);

  /** The applied filters, paired with their field so the chips can render without a lookup. */
  const active = $derived(
    fields.flatMap((field) => {
      const filter = filters[field.name];
      return filter ? [{ field, filter }] : [];
    }),
  );

  function optionsFor(field: Field): readonly RelationOption[] {
    return field.type === "relation" ? (relationOptions[field.collection] ?? []) : [];
  }

  /**
   * The whole panel is applied at once, from the submitted form: several filters usually change
   * together, and applying each one as it is touched would be a page load per keystroke and per
   * select. Enter inside any control submits, because the panel is a real `<form>`.
   * @param event - The form's submit event.
   */
  function apply(
    event: SubmitEvent & { currentTarget: EventTarget & HTMLFormElement },
  ): void {
    event.preventDefault();
    onapply(formFilters(fields, new FormData(event.currentTarget)));
  }

  /**
   * Drops one applied filter. Immediate rather than pending, unlike an edit in the panel: a chip
   * shows what the list is filtered by right now, so its `×` has to act on that and not on a draft.
   * @param name - The field whose filter to drop.
   */
  function remove(name: string): void {
    const next = { ...filters };
    delete next[name];
    onapply(next);
  }
</script>

<div class="filters">
  <div class="bar">
    <button
      type="button"
      class="toggle"
      class:open
      aria-expanded={open}
      aria-controls="shuri-filter-panel"
      onclick={() => (open = !open)}
    >
      Filtros
      {#if active.length > 0}<span class="count">{active.length}</span>{/if}
      <Icon name={open ? "chevronUp" : "chevronDown"} size={11} />
    </button>

    {#if active.length > 0}
      <div class="chips">
        {#each active as { field, filter } (field.name)}
          {@const text = describeFilter(field, filter, relationLabels)}
          <button
            type="button"
            class="chip"
            title="Remover filtro: {text}"
            onclick={() => remove(field.name)}
          >
            {text}
            <span class="x" aria-hidden="true">×</span>
          </button>
        {/each}
        <button type="button" class="clear" onclick={() => onapply({})}>Limpar</button>
      </div>
    {/if}
  </div>

  {#if open}
    <form id="shuri-filter-panel" class="panel" onsubmit={apply}>
      <div class="grid">
        {#each fields as field (field.name)}
          {@const ops = filterOps(field)}
          {@const applied = filters[field.name]}
          {@const id = `shuri-filter-${field.name}`}
          <FormField {id} label={fieldLabel(field)}>
            <div class="control">
              <!--
                The operator select is drawn only where there is a choice to make: a `select` field
                can only be asked for equality, and a box beside it offering just "=" would be a
                control that never does anything.
              -->
              {#if ops.length > 1}
                <select
                  class="shuri-select op"
                  name={opName(field)}
                  value={applied?.op ?? ops[0]}
                  aria-label="Operador do filtro de {fieldLabel(field)}"
                >
                  {#each ops as op (op)}
                    <option value={op}>{OP_LABELS[op]}</option>
                  {/each}
                </select>
              {/if}
              <FilterControl
                {field}
                {id}
                name={filterName(field)}
                value={applied?.text ?? ""}
                options={optionsFor(field)}
              />
            </div>
          </FormField>
        {/each}
      </div>

      <div class="acts">
        <Button type="submit" variant="primary" size="sm">Aplicar filtros</Button>
        {#if active.length > 0}
          <Button size="sm" onclick={() => onapply({})}>Limpar</Button>
        {/if}
      </div>
    </form>
  {/if}
</div>

<style>
  .filters {
    border-bottom: 1px solid var(--shuri-border);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 20px;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--shuri-text-muted);
    background: transparent;
    border: 1px solid var(--shuri-border-strong);
    border-radius: var(--shuri-radius-sm);
    cursor: pointer;
    transition:
      color 0.18s var(--shuri-ease),
      border-color 0.18s var(--shuri-ease);
  }

  .toggle:hover,
  .toggle.open {
    color: var(--shuri-text);
    border-color: var(--shuri-text);
  }

  /* How many filters the collapsed panel is hiding — the one thing the toggle can't show. */
  .count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    font-size: 11px;
    color: var(--shuri-surface);
    background: var(--shuri-text);
    border-radius: 999px;
  }

  .chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 40ch;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    color: var(--shuri-c2-deep);
    background: var(--shuri-info-soft);
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .x {
    font-size: 14px;
    line-height: 1;
    opacity: 0.5;
  }

  .chip:hover .x {
    opacity: 1;
  }

  .clear {
    padding: 0;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--shuri-text-muted);
    background: none;
    border: 0;
    cursor: pointer;
  }

  .clear:hover {
    color: var(--shuri-text);
  }

  .panel {
    padding: 4px 20px 18px;
  }

  /*
    One column per filter, as many as fit: the number of filters is the collection's business, so the
    row count follows the schema instead of a layout decided here.
  */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px var(--shuri-gap);
  }

  .control {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Wide enough for the widest operator and no wider — the value is what the author reads. */
  .op {
    width: auto;
    flex: none;
    padding: 11px 8px;
    text-align: center;
  }

  .acts {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }
</style>
