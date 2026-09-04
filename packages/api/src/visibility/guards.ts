import { hiddenFieldNames, type RecordSchema } from "@shuri/core";
import type { Query, RecordInput } from "@shuri/store";
import { HiddenFieldError } from "./errors.js";

/**
 * Rejects a request body that writes a field declared `hidden`. Mirrors the store's own refusal of
 * an `id` in a payload, and for the same reason: what a request may set is decided here, not left to
 * whoever remembers to strip it.
 * @param schema - The schema declaring which fields are hidden.
 * @param data - The record payload read off the request body.
 * @returns Nothing; throws `HiddenFieldError` when the payload writes a hidden field.
 */
export function assertWritableRecord(schema: RecordSchema, data: RecordInput): void {
  const hidden = hiddenFieldNames(schema);
  if (hidden.size === 0) return;

  const written = Object.keys(data).filter((key) => hidden.has(key));
  if (written.length > 0) throw new HiddenFieldError(written);
}

/**
 * Rejects a query that filters or sorts by a field declared `hidden`. Without this,
 * `?where={"passwordHash":{"op":"contains","value":"a"}}` turns a redacted field into an oracle that
 * reads it back one character at a time.
 * @param schema - The schema declaring which fields are hidden.
 * @param query - The parsed query AST.
 * @returns Nothing; throws `HiddenFieldError` when the query names a hidden field.
 */
export function assertQueryableFields(schema: RecordSchema, query: Query): void {
  const hidden = hiddenFieldNames(schema);
  if (hidden.size === 0) return;

  const named = [
    ...Object.keys(query.where ?? {}),
    ...(query.orderBy ?? []).map((entry) => entry.field),
  ];
  const used = [...new Set(named.filter((field) => hidden.has(field)))];
  if (used.length > 0) throw new HiddenFieldError(used, "query");
}
