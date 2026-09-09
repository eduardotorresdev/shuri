import type { Field } from "@shuri/core";
import type { AdminCollection } from "$shared/schema.js";

/**
 * How many columns a list shows. A cap rather than every field: a collection with twenty fields
 * would render a table nobody can read horizontally, and the record's own page shows all of them
 * anyway. The first few declared fields are the ones an author identifies a record by.
 */
const MAX_COLUMNS = 5;

/**
 * Chooses the columns of a collection's list, in declaration order, with the labelling field first.
 *
 * `textarea` fields are dropped: a body paragraph flattened into a cell pushes every other column
 * off the screen and still shows nothing useful.
 * @param collection - The collection whose list is being drawn.
 * @returns The fields to show as columns.
 */
export function listColumns(collection: AdminCollection): readonly Field[] {
  const shown = collection.fields.filter((field) => field.type !== "textarea");
  const label = shown.find((field) => field.name === collection.labelField);
  const rest = shown.filter((field) => field !== label);

  return (label ? [label, ...rest] : rest).slice(0, MAX_COLUMNS);
}

/**
 * Whether a column can be sorted on: the store orders by a stored scalar, not by a list.
 * @param field - The column's field.
 * @returns Whether the list may be ordered by `field`.
 */
export function isSortable(field: Field): boolean {
  const multiple =
    (field.type === "select" || field.type === "relation") && field.multiple;
  return !multiple;
}
