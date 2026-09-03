import { validate } from "@shuri/validate";
import { GlobalSchemaError } from "./errors.js";
import { globalsValidator } from "./schema.js";
import type { GlobalSchema } from "./types.js";

/**
 * Validates `globals` (slugs unique, `category.title`/`title` required, fields well-formed), throwing
 * `GlobalSchemaError` if invalid. Relation fields on a global may reference any of `collectionSlugs`.
 * @param globals - The declared globals to validate.
 * @param collectionSlugs - The collection slugs a global's relation fields may reference.
 * @returns `globals`, unchanged, once validated.
 */
export function defineGlobals<const G extends readonly GlobalSchema[]>(
  globals: G,
  collectionSlugs: Set<string>,
): G {
  const issues = validate(
    globals as unknown as GlobalSchema[],
    globalsValidator(collectionSlugs),
    "globals",
  );
  if (issues.length > 0) {
    throw new GlobalSchemaError(issues);
  }
  return globals;
}
