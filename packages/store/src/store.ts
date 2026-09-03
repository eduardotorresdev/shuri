import type {
  CollectionSchema,
  Core,
  GlobalSchema,
  InferCollections,
  InferGlobals,
} from "@shuri/core";
import type { StoreAdapter } from "./adapter.js";
import { createEventBus, type StoreEventBus } from "./events/bus.js";
import { bindCollection, type CollectionStore } from "./collections/store.js";
import { UnknownCollectionError } from "./collections/errors.js";
import { bindGlobal, type GlobalStore } from "./globals/store.js";
import { UnknownGlobalError } from "./globals/errors.js";

/**
 * Single persistence entry point for every collection and global declared on a `Core`, backed by
 * one adapter. `collection(slug)`/`global(slug)` are typed per the fields declared for that slug:
 * `T`/`G` flow in from `createCore`. Every store owns one event bus, published to by every write
 * and read back through `CollectionStore.subscribe`/`GlobalStore.subscribe` and `@shuri/api`'s SSE
 * route.
 */
export interface Store<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> {
  collection<S extends T[number]["slug"]>(
    slug: S,
  ): CollectionStore<InferCollections<T>[S]>;
  global<S extends G[number]["slug"]>(slug: S): GlobalStore<InferGlobals<G>[S]>;
  /** Every event of every collection and global of this store, in one stream. */
  readonly events: StoreEventBus;
}

/**
 * Wires every collection and global declared on `core` to `adapter`, resolving one `CollectionStore`
 * per collection slug and one `GlobalStore` per global slug, all publishing to a single event bus
 * exposed as `store.events`.
 * @param core - The core holding the declared collection and global schemas.
 * @param adapter - The persistence adapter backing every collection and global.
 * @returns A `Store` exposing one `CollectionStore`/`GlobalStore` per declared slug.
 */
export function createStore<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(core: Core<T, G>, adapter: StoreAdapter): Store<T, G> {
  const collections = new Map<string, CollectionStore>();
  const globals = new Map<string, GlobalStore>();
  const events = createEventBus();

  return {
    events,
    collection(slug: string) {
      const cached = collections.get(slug);
      if (cached) return cached as never;

      const schema = core.getCollection(slug as T[number]["slug"]);
      if (!schema) throw new UnknownCollectionError(slug);

      const bound = bindCollection(
        schema as unknown as CollectionSchema,
        adapter,
        events,
      );
      collections.set(slug, bound);
      return bound as never;
    },
    global(slug: string) {
      const cached = globals.get(slug);
      if (cached) return cached as never;

      const schema = core.getGlobal(slug as G[number]["slug"]);
      if (!schema) throw new UnknownGlobalError(slug);

      const bound = bindGlobal(schema as unknown as GlobalSchema, adapter, events);
      globals.set(slug, bound);
      return bound as never;
    },
  };
}
