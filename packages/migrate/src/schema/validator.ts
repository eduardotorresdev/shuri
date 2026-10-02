import {
  all,
  boolean,
  discriminated,
  matches,
  objectOf,
  oneOf,
  record,
  refine,
  string,
  validate,
  type Issue,
  type Validator,
} from "@shuri/validate";
import { integrityIssues } from "./integrity.js";
import { FIELD_PATTERN, RESERVED_FIELD, SLUG_PATTERN } from "./names.js";
import { SNAPSHOT_VERSION } from "./snapshot.js";

export const unknownKey = (key: string): string => `unknown property "${key}"`;

/** A collection/global slug. */
export const slugValidator: Validator<unknown> = all(
  string("must be a string"),
  matches(SLUG_PATTERN, `must match ${SLUG_PATTERN}`),
);

/** A field name: pattern-conformant and not the reserved `id`. */
export const fieldNameValidator: Validator<unknown> = all(
  string("must be a string"),
  matches(FIELD_PATTERN, `must match ${FIELD_PATTERN}`),
  refine<unknown>((name) => name !== RESERVED_FIELD, `"${RESERVED_FIELD}" is reserved`),
);

const index = boolean('"index" must be a boolean');
const multiple = boolean('"multiple" must be a boolean');

// `discriminated` already verified the tag; this only declares the key so it is not "unknown".
const tagIsChecked: Validator<unknown> = () => undefined;

function variants(withIndex: boolean): Record<string, Validator<unknown>> {
  const idx = withIndex ? { index } : {};
  const tagged = (type: string, fields: Record<string, Validator<unknown>>) =>
    objectOf<Record<string, unknown>>(
      { type: tagIsChecked, ...fields, ...idx },
      "must be an object",
      { unknownKeyMessage: unknownKey },
    );
  return {
    text: tagged("text", {}),
    textarea: tagged("textarea", {}),
    email: tagged("email", {}),
    boolean: tagged("boolean", {}),
    number: tagged("number", { kind: oneOf<unknown>(["integer", "float"]) }),
    select: tagged("select", { multiple }),
    relation: tagged("relation", { collection: slugValidator, multiple }),
  };
}

/** The persisted description of a field (type, type-specific traits, index). */
export const fieldSpecValidator: Validator<unknown> = discriminated(
  "type",
  variants(true),
);

/** A field spec without `index` (what `alterField.from/to` carry). */
export const fieldShapeValidator: Validator<unknown> = discriminated(
  "type",
  variants(false),
);

const entityValidator = objectOf<Record<string, unknown>>(
  {
    fields: record(fieldSpecValidator, "must be an object", { key: fieldNameValidator }),
  },
  "must be an object",
  { unknownKeyMessage: unknownKey },
);

/** Structural validity of a `SchemaSnapshot` (cross-references are `checkIntegrity`'s job). */
export const snapshotValidator: Validator<unknown> = objectOf<Record<string, unknown>>(
  {
    version: oneOf<unknown>([SNAPSHOT_VERSION]),
    collections: record(entityValidator, "must be an object", { key: slugValidator }),
    globals: record(entityValidator, "must be an object", { key: slugValidator }),
  },
  "must be an object",
  { unknownKeyMessage: unknownKey },
);

/**
 * Validates untrusted data as a snapshot: structure and names first; once the structure is sound,
 * also its referential integrity (dangling relations, indexed globals).
 * @param value - The data to validate.
 * @returns The issues found; empty when `value` is a sound `SchemaSnapshot`.
 */
export function validateSnapshot(value: unknown): Issue[] {
  const issues = validate(value, snapshotValidator);
  if (issues.length > 0) return issues;
  return integrityIssues(value as never).map(({ slot, message }) => ({
    path: slot,
    message,
  }));
}
