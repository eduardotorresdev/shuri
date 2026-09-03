import { validate } from "@shuri/validate";
import { defineGlobals } from "../globals/define.js";
import type { GlobalSchema } from "../globals/types.js";
import { CollectionSchemaError } from "./errors.js";
import { collectionsValidator } from "./schema.js";
import type { CollectionSchema } from "./types.js";

type CollectionBySlug<T extends readonly CollectionSchema[]> = {
  [C in T[number] as C["slug"]]: C;
};

type GlobalBySlug<G extends readonly GlobalSchema[]> = {
  [Gl in G[number] as Gl["slug"]]: Gl;
};

export interface Core<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> {
  collections: T;
  globals: G;
  getCollection<S extends T[number]["slug"]>(slug: S): CollectionBySlug<T>[S] | undefined;
  getGlobal<S extends G[number]["slug"]>(slug: S): GlobalBySlug<G>[S] | undefined;
}

export interface CoreConfig<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[] = [],
> {
  collections: T;
  globals?: G;
}

export function defineCollections<const T extends readonly CollectionSchema[]>(
  collections: T,
): T {
  const issues = validate(
    collections as unknown as CollectionSchema[],
    collectionsValidator,
    "collections",
  );
  if (issues.length > 0) {
    throw new CollectionSchemaError(issues);
  }
  return collections;
}

export function createCore<
  const T extends readonly CollectionSchema[],
  const G extends readonly GlobalSchema[] = [],
>(config: CoreConfig<T, G>): Core<T, G> {
  const collections = defineCollections(config.collections);
  const collectionSlugs = new Set(collections.map((collection) => collection.slug));
  const globals = defineGlobals((config.globals ?? []) as G, collectionSlugs);

  const collectionsBySlug = new Map<string, CollectionSchema>(
    collections.map((collection) => [collection.slug, collection]),
  );
  const globalsBySlug = new Map<string, GlobalSchema>(
    globals.map((global) => [global.slug, global]),
  );

  return {
    collections,
    globals,
    getCollection(slug: string) {
      return collectionsBySlug.get(slug) as never;
    },
    getGlobal(slug: string) {
      return globalsBySlug.get(slug) as never;
    },
  };
}
