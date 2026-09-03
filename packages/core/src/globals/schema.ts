import { keyedArray, object, required, type Validator } from "@shuri/validate";
import { fieldsValidator } from "../fields/validator.js";
import type { GlobalSchema } from "./types.js";

function globalValidator(collectionSlugs: Set<string>): Validator<GlobalSchema> {
  return object<GlobalSchema>({
    slug: required('"slug" is required'),
    title: required('"title" is required'),
    category: object({ title: required('"title" is required') }),
    fields: fieldsValidator(collectionSlugs),
  });
}

/**
 * Validates a globals schema's own shape; the record(s) it describes are validated separately
 * (see `recordValidator`).
 * @param collectionSlugs - The collection slugs a global's relation fields may reference.
 * @returns A validator for a declared `globals` array.
 */
export function globalsValidator(
  collectionSlugs: Set<string>,
): Validator<GlobalSchema[]> {
  return (globals, ctx) => {
    keyedArray(
      (global) => global.slug || "(missing slug)",
      globalValidator(collectionSlugs),
      {
        dedupeKey: (global) => global.slug || undefined,
        duplicateMessage: (slug) => `duplicate global slug "${slug}"`,
      },
    )(globals, ctx);
  };
}
