import { validateRecord, type CollectionSchema, type RecordValidatorOptions } from "@shuri/core";
import { RecordValidationError } from "./errors.js";
import type { RecordInput } from "./record.js";

/** Guards `insert`/`update`: throws `RecordValidationError` before a record ever reaches the adapter. */
export function assertValidRecord(collection: CollectionSchema, data: RecordInput, options?: RecordValidatorOptions): void {
  const issues = validateRecord(collection, data, options);
  if (issues.length > 0) throw new RecordValidationError(collection.slug, issues);
}
