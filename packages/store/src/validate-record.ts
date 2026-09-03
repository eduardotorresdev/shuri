import {
  validateRecord,
  type RecordSchema,
  type RecordValidatorOptions,
} from "@shuri/core";
import { RecordValidationError } from "./errors.js";
import type { RecordInput } from "./record.js";

/**
 * Guards `insert`/`update`: throws `RecordValidationError` before a record ever reaches the adapter.
 * @param schema - The `{ slug, fields }` schema (a collection or a global) whose declared fields validate `data`.
 * @param data - The candidate record to validate.
 * @param [options] - Validation options, e.g. `{ partial: true }` for updates.
 * @returns Nothing; throws instead of returning on invalid input.
 */
export function assertValidRecord(
  schema: RecordSchema,
  data: RecordInput,
  options?: RecordValidatorOptions,
): void {
  const issues = validateRecord(schema, data, options);
  if (issues.length > 0) throw new RecordValidationError(schema.slug, issues);
}
