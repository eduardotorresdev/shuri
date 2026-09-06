<script lang="ts">
  import type { OrderBy, StoreRecord } from "@shuri/store";
  import type { AdminCollection } from "$shared/schema.js";
  import Icon from "../ui/Icon.svelte";
  import {
    EMPTY_CELL,
    fieldLabel,
    formatCell,
    type RelationLabels,
  } from "../fields/values.js";
  import { isSortable, listColumns } from "./columns.js";

  interface Props {
    collection: AdminCollection;
    records: readonly StoreRecord[];
    /** Builds the link to a record's edit page, so the table stays free of routing knowledge. */
    href: (record: StoreRecord) => string;
    /** `id -> label` per referenced collection, so a relation column reads as a name and not a uuid. */
    relationLabels?: RelationLabels;
    order?: OrderBy;
    onsort?: (field: string) => void;
    ondelete?: (record: StoreRecord) => void;
  }

  let {
    collection,
    records,
    href,
    relationLabels = {},
    order,
    onsort,
    ondelete,
  }: Props = $props();

  const columns = $derived(listColumns(collection));

  function ariaSort(field: string): "ascending" | "descending" | "none" {
    if (order?.field !== field) return "none";
    return order.direction === "desc" ? "descending" : "ascending";
  }
</script>

<div class="scroll">
  <table>
    <thead>
      <tr>
        {#each columns as column (column.name)}
          <th scope="col" aria-sort={ariaSort(column.name)}>
            {#if onsort && isSortable(column)}
              {@const on = order?.field === column.name}
              <button
                type="button"
                class="sort"
                class:on
                title="Ordenar por {fieldLabel(column)}"
                onclick={() => onsort(column.name)}
              >
                {fieldLabel(column)}
                <!--
                  The caret is drawn for every sortable column and faded in on hover: a column that
                  can be sorted looks no different from one that cannot until you reach for it.
                -->
                <span class="caret">
                  <Icon
                    name={on && order?.direction === "desc" ? "chevronDown" : "chevronUp"}
                    size={11}
                  />
                </span>
              </button>
            {:else}
              {fieldLabel(column)}
            {/if}
          </th>
        {/each}
        <th scope="col"><span class="shuri-sr-only">Ações</span></th>
      </tr>
    </thead>
    <tbody>
      {#each records as record (record.id)}
        <tr>
          {#each columns as column, index (column.name)}
            {@const text = formatCell(column, record[column.name], relationLabels)}
            <td class:lead={index === 0}>
              <!--
                Only the first cell links: a row of links makes every cell a click target that goes
                to the same place, and turns text selection in the table into navigation.
              -->
              {#if index === 0}
                <a class="lead-link" href={href(record)}>{text}</a>
              {:else if column.type === "select" && text !== EMPTY_CELL}
                <!-- A closed set of values reads as a pill, the way the schema declared it: a state. -->
                <span class="shuri-badge">{text}</span>
              {:else}
                {text}
              {/if}
            </td>
          {/each}
          <td class="actions">
            <!--
              The flex row is inside the cell, not the cell itself: a `<td>` told to be a flex
              container stops being a table cell, and the row's own alignment and borders go with it.
            -->
            <span>
              <a href={href(record)}>Editar</a>
              {#if ondelete}
                <button type="button" class="delete" onclick={() => ondelete(record)}>
                  Remover
                </button>
              {/if}
            </span>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 14px 20px;
    text-align: left;
    vertical-align: middle;
  }

  th {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--shuri-text-faint);
    border-bottom: 1px solid var(--shuri-border);
  }

  .sort {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
    user-select: none;
    transition: color 0.16s ease;
  }

  .sort:hover {
    color: var(--shuri-text-muted);
  }

  .sort.on {
    color: var(--shuri-text);
  }

  .caret {
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  .sort:hover .caret {
    opacity: 0.45;
  }

  .sort.on .caret {
    opacity: 1;
  }

  td {
    max-width: 34ch;
    font-size: 13px;
    color: var(--shuri-text-muted);
    border-bottom: 1px solid rgb(10 10 10 / 6%);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* The labelling column is the record's name, so it is the one cell drawn in full-strength ink. */
  .lead {
    font-size: 14px;
    font-weight: 500;
    color: var(--shuri-text);
  }

  .lead-link {
    color: inherit;
    font-weight: inherit;
  }

  .lead-link:hover {
    color: var(--shuri-accent);
  }

  tbody tr {
    transition: background 0.15s ease;
  }

  tbody tr:hover {
    background: var(--shuri-panel);
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  .actions {
    text-align: right;
    white-space: nowrap;
  }

  .actions span {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }

  .delete {
    padding: 0;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    color: var(--shuri-danger-deep);
    background: none;
    border: 0;
    cursor: pointer;
  }

  .delete:hover {
    color: var(--shuri-text);
  }
</style>
