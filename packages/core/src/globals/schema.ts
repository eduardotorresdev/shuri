import { keyedArray, object, required, type Validator } from "@shuri/validate";
import { GLOBAL_ACCESS_OPS } from "../access/types.js";
import { accessValidator } from "../access/validator.js";
import { fieldsValidator } from "../fields/validator.js";
import { slugValidator } from "../fields/slug.js";
import { GLOBAL_HOOK_NAMES } from "../hooks/types.js";
import { hooksValidator } from "../hooks/validator.js";
import type { GlobalSchema } from "./types.js";

function globalValidator(collectionSlugs: Set<string>): Validator<GlobalSchema> {
  return object<GlobalSchema>({
    slug: slugValidator,
    title: required('"title" is required'),
    category: object({ title: required('"title" is required') }),
    access: accessValidator(GLOBAL_ACCESS_OPS),
    hooks: hooksValidator(GLOBAL_HOOK_NAMES),
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
