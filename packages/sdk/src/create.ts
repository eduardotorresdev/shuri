import { createCore, type CollectionSchema, type Core, type InferCollection } from "@shuri/core";
import { createStore, type CollectionStore, type Store, type StoreAdapter } from "@shuri/store";

export interface CreateConfig<T extends readonly CollectionSchema[]> {
  collections: T;
  adapter: StoreAdapter;
}

/** One `CollectionStore` per declared slug, so `app.posts.insert(...)` is typed per that collection's fields. */
type AppCollections<T extends readonly CollectionSchema[]> = {
  [C in T[number] as C["slug"]]: CollectionStore<InferCollection<C>>;
};

/** Property names owned by the facade itself; a collection slug can't shadow one of these. */
const RESERVED_KEYS = new Set(["core", "store"]);

/**
 * Facade tying a collections schema to a persistence adapter. Exposes one property per collection
 * slug (`app.posts.insert(...)`), plus `core` and `store` for lower-level/dynamic access.
 */
export type ShuriApp<T extends readonly CollectionSchema[] = CollectionSchema[]> = AppCollections<T> & {
  core: Core<T>;
  store: Store<T>;
};

/** Pins one `CollectionStore` per declared slug directly onto `app`, e.g. `app.posts`. */
function attachCollections<T extends readonly CollectionSchema[]>(
  app: Record<string, unknown>,
  core: Core<T>,
  store: Store<T>,
): void {
  for (const collection of core.collections) {
    if (RESERVED_KEYS.has(collection.slug)) {
      throw new Error(`Collection slug "${collection.slug}" is reserved; rename it to use the app.<slug> shortcut.`);
    }
    app[collection.slug] = store.collection(collection.slug);
  }
}

/**
 * Entry point of `@shuri/sdk`. `T` is inferred from `collections`, so every `app.<slug>` is typed
 * per the fields declared for that slug, no manual types needed.
 */
export function create<const T extends readonly CollectionSchema[]>(config: CreateConfig<T>): ShuriApp<T> {
  const core = createCore({ collections: config.collections });
  const store = createStore(core, config.adapter);

  const app: Record<string, unknown> = { core, store };
  attachCollections(app, core, store);

  return app as ShuriApp<T>;
}
