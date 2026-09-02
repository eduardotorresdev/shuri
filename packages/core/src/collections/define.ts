import { validate } from "@shuri/validate";
import { CollectionSchemaError } from "./errors.js";
import { collectionsValidator } from "./schema.js";
import type { CollectionSchema } from "./types.js";

export interface Core {
  collections: CollectionSchema[];
  getCollection(slug: string): CollectionSchema | undefined;
}

export interface CoreConfig {
  collections: CollectionSchema[];
}

export function defineCollections(collections: CollectionSchema[]): CollectionSchema[] {
  const issues = validate(collections, collectionsValidator, "collections");
  if (issues.length > 0) {
    throw new CollectionSchemaError(issues);
  }
  return collections;
}

export function createCore(config: CoreConfig): Core {
  const collections = defineCollections(config.collections);
  const bySlug = new Map(collections.map((collection) => [collection.slug, collection]));

  return {
    collections,
    getCollection(slug: string) {
      return bySlug.get(slug);
    },
  };
}
