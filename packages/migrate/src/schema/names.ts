import { RESERVED_FIELD_NAME } from "@shuri/core";

/**
 * Collection and global slugs. Starts lowercase (so never with the reserved `_`), then letters of
 * either case, digits, `_` and `-`. Uppercase is allowed after the first character because the demo
 * already ships a global called `seoDefaults` and renaming an existing slug would break its data.
 */
export const SLUG_PATTERN = /^[a-z][A-Za-z0-9_-]{0,62}$/;

/** Field names. `id` matches the pattern but is reserved (see `RESERVED_FIELD_NAME`). */
export const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

/** The implicit identifier every record has; `@shuri/core` rejects a schema that declares it. */
export const RESERVED_FIELD = RESERVED_FIELD_NAME;

/**
 * @param value - Candidate slug.
 * @returns Whether it is a valid collection/global slug.
 */
export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * @param value - Candidate field name.
 * @returns Whether it is a valid, non-reserved field name.
 */
export function isFieldName(value: string): boolean {
  return FIELD_PATTERN.test(value) && value !== RESERVED_FIELD;
}
