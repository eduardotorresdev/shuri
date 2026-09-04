import type { CollectionSchema } from "./types.js";
import type { RecordInput, RecordSchema } from "./validate-record.js";

const cache = new WeakMap<RecordSchema, ReadonlySet<string>>();

/**
 * The names of `schema`'s fields declared `hidden`, i.e. the ones that must never leave through
 * HTTP. Memoized per schema object: a list response redacts once per record, and a schema is a
 * long-lived literal.
 * @param schema - The collection or global schema to read the flags off.
 * @returns The set of hidden field names, empty when none is declared.
 */
export function hiddenFieldNames(schema: RecordSchema): ReadonlySet<string> {
  const cached = cache.get(schema);
  if (cached) return cached;

  const names = new Set<string>();
  for (const field of schema.fields) {
    if (field.hidden) names.add(field.name);
  }
  cache.set(schema, names);
  return names;
}

/**
 * Returns `record` without `schema`'s hidden fields.
 *
 * **Copies, never mutates.** An adapter may well hand out the live object it stores (
 * `createMemoryAdapter` does), so deleting a key here would erase the value from the store for good
 * — a password hash included. When nothing is hidden the original is returned untouched, since
 * there is nothing to copy away.
 * @param schema - The schema declaring which fields are hidden.
 * @param record - The record to redact.
 * @returns A record carrying every non-hidden field of `record`.
 */
export function redactRecord<R extends RecordInput>(schema: RecordSchema, record: R): R {
  const hidden = hiddenFieldNames(schema);
  if (hidden.size === 0) return record;

  const redacted: RecordInput = {};
  for (const [key, value] of Object.entries(record)) {
    if (!hidden.has(key)) redacted[key] = value;
  }
  return redacted as R;
}

/**
 * Redacts every record of a list. See `redactRecord`.
 * @param schema - The schema declaring which fields are hidden.
 * @param records - The records to redact.
 * @returns The redacted records, in the same order.
 */
export function redactRecords<R extends RecordInput>(
  schema: RecordSchema,
  records: readonly R[],
): R[] {
  const hidden = hiddenFieldNames(schema);
  if (hidden.size === 0) return [...records];
  return records.map((record) => redactRecord(schema, record));
}

/**
 * Filters out the collections HTTP doesn't serve, so a caller enumerating collections (the OpenAPI
 * document) can't describe a route that answers 404.
 * @param collections - Every declared collection.
 * @returns Only the collections not declared `internal`.
 */
export function servableCollections(
  collections: readonly CollectionSchema[],
): readonly CollectionSchema[] {
  return collections.filter((collection) => !collection.internal);
}
