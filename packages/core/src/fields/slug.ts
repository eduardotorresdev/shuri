import { all, refine, required, type Validator } from "@shuri/validate";

/** Prefix reserved for names Shuri keeps for itself (for example the Mongo `_globals` collection). */
export const RESERVED_SLUG_PREFIX = "_";

/** The field name every record carries implicitly (its identifier), so a schema cannot declare it. */
export const RESERVED_FIELD_NAME = "id";

/**
 * Validates a collection or global `slug`: required, and not starting with the reserved `_` prefix.
 * Shared by collections and globals, whose slugs live in the same namespace.
 */
export const slugValidator: Validator<string> = all<string>(
  required('"slug" is required'),
  refine(
    (slug) => !slug.startsWith(RESERVED_SLUG_PREFIX),
    (slug) =>
      `slug "${slug}" cannot start with "${RESERVED_SLUG_PREFIX}": that prefix is reserved`,
  ),
);

/**
 * Validates a field `name`: required, and not the reserved `id`.
 */
export const fieldNameValidator: Validator<string> = all<string>(
  required('"name" is required'),
  refine(
    (name) => name !== RESERVED_FIELD_NAME,
    `"${RESERVED_FIELD_NAME}" is reserved: every record already has an id`,
  ),
);
