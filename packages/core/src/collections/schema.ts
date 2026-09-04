import {
  boolean,
  keyedArray,
  object,
  optional,
  required,
  type Validator,
} from "@shuri/validate";
import { fieldsValidator } from "../fields/validator.js";
import type { CollectionSchema } from "./types.js";

function collectionValidator(slugs: Set<string>): Validator<CollectionSchema> {
  return object<CollectionSchema>({
    slug: required('"slug" is required'),
    title: required('"title" is required'),
    singular: required('"singular" is required'),
    plural: required('"plural" is required'),
    internal: optional(boolean('"internal" must be a boolean')),
    fields: fieldsValidator(slugs),
  });
}

/**
 * Validates a collections schema's own shape; the records it describes are validated separately
 * (see `recordValidator`).
 * @param collections - The declared collections to validate.
 * @param ctx - The validation context issues are reported to.
 */
export const collectionsValidator: Validator<CollectionSchema[]> = (collections, ctx) => {
  const slugs = new Set(collections.map((collection) => collection.slug));

  keyedArray(
    (collection) => collection.slug || "(missing slug)",
    collectionValidator(slugs),
    {
      dedupeKey: (collection) => collection.slug || undefined,
      duplicateMessage: (slug) => `duplicate collection slug "${slug}"`,
    },
  )(collections, ctx);
};
