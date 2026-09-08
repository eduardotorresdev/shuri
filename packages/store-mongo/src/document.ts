import type { RecordInput, StoreRecord } from "@shuri/store";
import type { Document } from "mongodb";

/** Shape of a stored document: the record's fields plus its id under Mongo's `_id`. */
export type StoredDocument = Document & { _id: string };

/**
 * Maps a record field name to its document path: `id` lives in `_id`, everything else as is.
 * @param field - The record field name.
 * @returns The path to use in filters and sorts.
 */
export function pathOf(field: string): string {
  return field === "id" ? "_id" : field;
}

/**
 * Strips the `_id` off a document, leaving only the record's fields.
 * @param document - The stored document.
 * @returns The fields without `_id`.
 */
export function fieldsOf(document: StoredDocument): RecordInput {
  const { _id, ...fields } = document;
  return fields;
}

/**
 * Converts a stored document back into a `StoreRecord` (`_id` -> `id`).
 * @param document - The stored document.
 * @returns The record.
 */
export function toRecord(document: StoredDocument): StoreRecord {
  const { _id, ...fields } = document;
  return { ...fields, id: _id };
}

/**
 * Drops the id from a payload so it can never be written into a document's body.
 * @param data - The record payload as received from the store.
 * @returns The payload without its `id`, ready for `$set`/`insertOne`.
 */
export function bodyOf(data: RecordInput): Document {
  const { id: _id, ...body } = data;
  return body;
}
