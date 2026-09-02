import { createCore, type CollectionSchema, type Core, type InferCollection } from "@shuri/core";
import { createStore, type CollectionStore, type Store, type StoreAdapter } from "@shuri/store";

export interface CreateConfig<T extends readonly CollectionSchema[]> {
  collections: T;
  adapter: StoreAdapter;
}

/** One `CollectionStore` per declared slug, so `app.collections.posts.insert(...)` is typed per that collection's fields. */
type AppCollections<T extends readonly CollectionSchema[]> = {
  [C in T[number] as C["slug"]]: CollectionStore<InferCollection<C>>;
};

/**
 * Facade tying a collections schema to a persistence adapter. Exposes one property per collection
 * slug under `collections` (`app.collections.posts.insert(...)`), plus `core` and `store` for
 * lower-level/dynamic access.
 */
export interface ShuriApp<T extends readonly CollectionSchema[] = CollectionSchema[]> {
  collections: AppCollections<T>;
  core: Core<T>;
  store: Store<T>;
}

/** Resolves one `CollectionStore` per declared slug, e.g. `collections.posts`. */
function buildCollections<T extends readonly CollectionSchema[]>(core: Core<T>, store: Store<T>): AppCollections<T> {
  const collections: Record<string, unknown> = {};
  for (const collection of core.collections) {
    collections[collection.slug] = store.collection(collection.slug);
  }
  return collections as AppCollections<T>;
}

/**
 * Entry point of `@shuri/sdk`. `T` is inferred from `collections`, so every `app.collections.<slug>`
 * is typed per the fields declared for that slug, no manual types needed.
 */
export function create<const T extends readonly CollectionSchema[]>(config: CreateConfig<T>): ShuriApp<T> {
  const core = createCore({ collections: config.collections });
  const store = createStore(core, config.adapter);

  return { core, store, collections: buildCollections(core, store) };
}
