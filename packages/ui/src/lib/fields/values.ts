import type { Field, SelectField } from "@shuri/core";
import type { RecordInput, StoreRecord } from "@shuri/store";
import type { AdminCollection } from "$shared/schema.js";

/**
 * What a table cell shows for a value that is not there. Exported because a cell has to be able to
 * tell "no value" from a value before deciding how to draw it — an em dash rendered as a badge
 * would be a pill announcing an absence.
 */
export const EMPTY_CELL = "—";

/** `record id -> label` per referenced collection, the read-only view a table needs of relation options. */
export type RelationLabels = Record<string, Readonly<Record<string, string>>>;

/**
 * Whether a field holds a list of values, and so needs a list-shaped control and empty value.
 * @param field - The field to inspect.
 * @returns Whether `field` holds several values.
 */
export function isMultiple(field: Field): boolean {
  return (
    (field.type === "select" || field.type === "relation") && field.multiple === true
  );
}

/**
 * The value a control starts at for a field with nothing stored yet.
 *
 * Every control is bound to a defined value, never to `undefined`: an input that switches between
 * `undefined` and a string switches between uncontrolled and controlled halfway through typing, and
 * the browser resets the caret when it does. `emptyRecord` strips these back out before a write, so
 * an untouched optional field is still absent from the request rather than sent as `""`.
 * @param field - The field to produce a starting value for.
 * @returns The empty value for `field`'s control.
 */
export function emptyValue(field: Field): unknown {
  if (isMultiple(field)) return [];
  if (field.type === "boolean") return false;
  if (field.type === "number") return "";
  return "";
}

/**
 * Builds the form state for a record, one entry per field, filling in the stored value where there
 * is one and `emptyValue` where there isn't.
 * @param fields - The fields to build state for.
 * @param [record] - The stored record to seed from, absent when creating.
 * @returns The form state, keyed by field name.
 */
export function formValues(
  fields: readonly Field[],
  record?: RecordInput,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const stored = record?.[field.name];
    values[field.name] =
      stored === undefined || stored === null ? emptyValue(field) : stored;
  }
  return values;
}

/**
 * Turns form state back into the body of a write, dropping every field left empty.
 *
 * Dropping rather than sending `""`/`null` is what keeps an optional field optional: the store
 * validates a present value against the field's rules, so an untouched `email` sent as `""` fails
 * the format check for a value the author never entered. A `boolean` is never dropped — `false` is
 * a value an author chose, not an absence.
 * @param fields - The fields the form was generated from.
 * @param values - The current form state.
 * @returns The record body to send.
 */
export function toRecordInput(
  fields: readonly Field[],
  values: Record<string, unknown>,
): RecordInput {
  const input: RecordInput = {};

  for (const field of fields) {
    const value = values[field.name];

    if (field.type === "boolean") {
      input[field.name] = value === true;
      continue;
    }
    if (isMultiple(field)) {
      const list = Array.isArray(value) ? value : [];
      if (list.length > 0) input[field.name] = list;
      continue;
    }
    if (field.type === "number") {
      if (value !== "" && value !== undefined) input[field.name] = Number(value);
      continue;
    }
    if (value !== "" && value !== undefined && value !== null) input[field.name] = value;
  }

  return input;
}

/**
 * The human-readable name of a field: its `label` when declared, else its `name`.
 * @param field - The field to name.
 * @returns The field's display name.
 */
export function fieldLabel(field: Field): string {
  return field.label ?? field.name;
}

/**
 * The label of a select option, by value. Falls back to the raw value for a stored value no longer
 * among the declared options — which happens whenever an option is removed from a schema that
 * already has records using it, and is worth showing rather than blanking.
 * @param field - The select field whose options to look through.
 * @param value - The stored value to label.
 * @returns The matching option's label, or `value` itself.
 */
export function optionLabel(field: SelectField, value: unknown): string {
  return field.options.find((option) => option.value === value)?.label ?? String(value);
}

/**
 * Renders a stored value as the short string a table cell shows.
 *
 * A relation is stored as an id, which says nothing to a reader, so the referenced records are
 * passed in — already loaded once for the whole page by `loadRelationOptions`, rather than fetched
 * per row. An id with no match falls back to itself: the referenced record was deleted, and showing
 * the dangling id is more use than showing a blank.
 * @param field - The field the value belongs to.
 * @param value - The stored value.
 * @param [relations] - The referenced records of every relation field, keyed by collection.
 * @returns The cell's text, {@link EMPTY_CELL} for an absent value.
 */
export function formatCell(
  field: Field,
  value: unknown,
  relations: RelationLabels = {},
): string {
  if (value === undefined || value === null || value === "") return EMPTY_CELL;
  if (field.type === "boolean") return value ? "Sim" : "Não";
  if (field.type === "select") {
    const values = Array.isArray(value) ? value : [value];
    return values.map((entry) => optionLabel(field, entry)).join(", ");
  }
  if (field.type === "relation") {
    const labels = relations[field.collection] ?? {};
    const values = Array.isArray(value) ? value : [value];
    return values.map((entry) => labels[String(entry)] ?? String(entry)).join(", ");
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * The string standing in for a whole record — a list row's first column, a relation option's text.
 * Uses the collection's derived `labelField`, falling back to the id when the collection has no
 * field that reads as a name, or when that field is empty on this record.
 * @param collection - The collection the record belongs to.
 * @param record - The record to label.
 * @returns The record's label.
 */
export function recordLabel(collection: AdminCollection, record: StoreRecord): string {
  const value = collection.labelField ? record[collection.labelField] : undefined;
  return typeof value === "string" && value !== "" ? value : record.id;
}
