import { formatIssue, validate } from "@shuri/validate";
import { collectionsValidator } from "./schema.js";
import type { CollectionSchema } from "./types.js";

export function validateCollections(collections: CollectionSchema[]): string[] {
  return validate(collections, collectionsValidator, "collections").map(formatIssue);
}
