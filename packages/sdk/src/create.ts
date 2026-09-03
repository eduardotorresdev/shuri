import {
  createApiHandler,
  createOpenApiHandler,
  type CreateApiHandlerOptions,
  type CreateOpenApiHandlerOptions,
} from "@shuri/api";
import { createCore, type CollectionSchema, type Core, type InferCollection } from "@shuri/core";
import { createStore, type CollectionStore, type Store, type StoreAdapter } from "@shuri/store";

export interface CreateConfig<T extends readonly CollectionSchema[]> {
  collections: T;
  adapter: StoreAdapter;
  /** Options for the HTTP handler exposed as `app.handler`. See `@shuri/api`'s `createApiHandler`. */
  api?: CreateApiHandlerOptions;
  /** Options for the OpenAPI document/docs page exposed on `app.handler`. See `@shuri/api`'s `createOpenApiHandler`. */
  openapi?: CreateOpenApiHandlerOptions;
}

/** One `CollectionStore` per declared slug, so `app.collections.posts.insert(...)` is typed per that collection's fields. */
type AppCollections<T extends readonly CollectionSchema[]> = {
  [C in T[number] as C["slug"]]: CollectionStore<InferCollection<C>>;
};

/**
 * Facade tying a collections schema to a persistence adapter - the single source of truth for both
 * programmatic access (`collections`/`core`/`store`) and HTTP access (`handler`). Exposes one
 * property per collection slug under `collections` (`app.collections.posts.insert(...)`), `core`
 * and `store` for lower-level/dynamic access, and `handler` to serve every collection over HTTP,
 * plus the OpenAPI document (`/openapi.json`) and a docs page (`/docs`) describing them:
 *
 *   const app = create({ collections, adapter });
 *   Deno.serve(app.handler);
 *   // or: Bun.serve({ fetch: app.handler });
 *   // or, mounted in Hono: honoApp.all("/collections/*", (c) => app.handler(c.req.raw));
 */
export interface ShuriApp<T extends readonly CollectionSchema[] = CollectionSchema[]> {
  collections: AppCollections<T>;
  core: Core<T>;
  store: Store<T>;
  handler: (request: Request) => Promise<Response>;
}

/**
 * Resolves one `CollectionStore` per declared slug, e.g. `collections.posts`.
 * @param core - The core holding the declared collection schemas.
 * @param store - The store to resolve each collection's `CollectionStore` from.
 * @returns One `CollectionStore` per declared slug.
 */
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
 * @param config - The collections schema, persistence adapter, and handler options.
 * @returns The app facade tying `config.collections` to `config.adapter`.
 */
export function create<const T extends readonly CollectionSchema[]>(config: CreateConfig<T>): ShuriApp<T> {
  const core = createCore({ collections: config.collections });
  const store = createStore(core, config.adapter);

  const openApiHandler = createOpenApiHandler({ core }, config.openapi);
  const apiHandler = createApiHandler({ store }, config.api);

  return {
    core,
    store,
    collections: buildCollections(core, store),
    handler: async (request) => (await openApiHandler(request)) ?? apiHandler(request),
  };
}
