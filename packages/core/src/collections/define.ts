import { validate } from "@shuri/validate";
import { CollectionSchemaError } from "./errors.js";
import { collectionsValidator } from "./schema.js";
import type { CollectionSchema } from "./types.js";

type CollectionBySlug<T extends readonly CollectionSchema[]> = {
  [C in T[number] as C["slug"]]: C;
};

export interface Core<T extends readonly CollectionSchema[] = CollectionSchema[]> {
  collections: T;
  getCollection<S extends T[number]["slug"]>(slug: S): CollectionBySlug<T>[S] | undefined;
}

export interface CoreConfig<T extends readonly CollectionSchema[]> {
  collections: T;
}

export function defineCollections<const T extends readonly CollectionSchema[]>(collections: T): T {
  const issues = validate(collections as unknown as CollectionSchema[], collectionsValidator, "collections");
  if (issues.length > 0) {
    throw new CollectionSchemaError(issues);
  }
  return collections;
}

export function createCore<const T extends readonly CollectionSchema[]>(config: CoreConfig<T>): Core<T> {
  const collections = defineCollections(config.collections);
  const bySlug = new Map<string, CollectionSchema>(collections.map((collection) => [collection.slug, collection]));

  return {
    collections,
    getCollection(slug: string) {
      return bySlug.get(slug) as never;
    },
  };
}
