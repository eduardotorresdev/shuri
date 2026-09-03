import {
  createApiHandler,
  createGlobalsApiHandler,
  createOpenApiHandler,
  type CreateApiHandlerOptions,
  type CreateGlobalsApiHandlerOptions,
  type CreateOpenApiHandlerOptions,
} from "@shuri/api";
import {
  createCore,
  type CollectionSchema,
  type Core,
  type GlobalSchema,
  type InferCollection,
  type InferGlobal,
} from "@shuri/core";
import {
  createStore,
  type CollectionStore,
  type GlobalStore,
  type Store,
  type StoreAdapter,
} from "@shuri/store";

export interface CreateConfig<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[] = [],
> {
  collections: T;
  globals?: G;
  adapter: StoreAdapter;
  /** Options for the HTTP handler exposed as `app.handler`. See `@shuri/api`'s `createApiHandler`. */
  api?: CreateApiHandlerOptions;
  /** Options for the globals HTTP handler exposed as `app.handler`. See `@shuri/api`'s `createGlobalsApiHandler`. */
  globalsApi?: CreateGlobalsApiHandlerOptions;
  /** Options for the OpenAPI document/docs page exposed on `app.handler`. See `@shuri/api`'s `createOpenApiHandler`. */
  openapi?: CreateOpenApiHandlerOptions;
}

/** One `CollectionStore` per declared slug, so `app.collections.posts.insert(...)` is typed per that collection's fields. */
type AppCollections<T extends readonly CollectionSchema[]> = {
  [C in T[number] as C["slug"]]: CollectionStore<InferCollection<C>>;
};

/** One `GlobalStore` per declared slug, so `app.globals.site.get()` is typed per that global's fields. */
type AppGlobals<G extends readonly GlobalSchema[]> = {
  [Gl in G[number] as Gl["slug"]]: GlobalStore<InferGlobal<Gl>>;
};

/**
 * Facade tying a collections/globals schema to a persistence adapter - the single source of truth
 * for both programmatic access (`collections`/`globals`) and HTTP access (`handler`). Exposes one
 * property per collection slug under `collections` (`app.collections.posts.insert(...)`) and one
 * property per global slug under `globals` (`app.globals.site.get()`), and `handler` to serve every
 * collection and global over HTTP, plus the OpenAPI document (`/openapi.json`) and a docs page
 * (`/docs`) describing them:
 *
 *   const app = create({ collections, globals, adapter });
 *   Deno.serve(app.handler);
 *   // or: Bun.serve({ fetch: app.handler });
 *   // or, mounted in Hono: honoApp.all("/collections/*", (c) => app.handler(c.req.raw));
 */
export interface ShuriApp<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> {
  collections: AppCollections<T>;
  globals: AppGlobals<G>;
  handler: (request: Request) => Promise<Response>;
}

/**
 * Resolves one `CollectionStore` per declared slug, e.g. `collections.posts`.
 * @param core - The core holding the declared collection schemas.
 * @param store - The store to resolve each collection's `CollectionStore` from.
 * @returns One `CollectionStore` per declared slug.
 */
function buildCollections<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(core: Core<T, G>, store: Store<T, G>): AppCollections<T> {
  const collections: Record<string, unknown> = {};
  for (const collection of core.collections) {
    collections[collection.slug] = store.collection(collection.slug);
  }
  return collections as AppCollections<T>;
}

/**
 * Resolves one `GlobalStore` per declared slug, e.g. `globals.site`.
 * @param core - The core holding the declared global schemas.
 * @param store - The store to resolve each global's `GlobalStore` from.
 * @returns One `GlobalStore` per declared slug.
 */
function buildGlobals<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(core: Core<T, G>, store: Store<T, G>): AppGlobals<G> {
  const globals: Record<string, unknown> = {};
  for (const global of core.globals) {
    globals[global.slug] = store.global(global.slug);
  }
  return globals as AppGlobals<G>;
}

/**
 * Entry point of `@shuri/sdk`. `T`/`G` are inferred from `collections`/`globals`, so every
 * `app.collections.<slug>`/`app.globals.<slug>` is typed per the fields declared for that slug, no
 * manual types needed.
 * @param config - The collections/globals schema, persistence adapter, and handler options.
 * @returns The app facade tying `config.collections`/`config.globals` to `config.adapter`.
 */
export function create<
  const T extends readonly CollectionSchema[],
  const G extends readonly GlobalSchema[] = [],
>(config: CreateConfig<T, G>): ShuriApp<T, G> {
  const core = createCore({
    collections: config.collections,
    globals: config.globals as G,
  });
  const store = createStore(core, config.adapter);

  const openApiHandler = createOpenApiHandler({ core }, config.openapi);
  const globalsApiHandler = createGlobalsApiHandler({ store }, config.globalsApi);
  const apiHandler = createApiHandler({ store }, config.api);

  return {
    collections: buildCollections(core, store),
    globals: buildGlobals(core, store),
    handler: async (request) =>
      (await openApiHandler(request)) ??
      (await globalsApiHandler(request)) ??
      apiHandler(request),
  };
}
