import {
  createHandler,
  type CreateApiHandlerOptions,
  type CreateGlobalsApiHandlerOptions,
  type CreateOpenApiHandlerOptions,
  type CreateRealtimeHandlerOptions,
} from "@shuri/api";
import {
  assertNoAuthSlugCollision,
  authCollections,
  createAuth,
  type AuthApi,
  type AuthConfig,
} from "@shuri/auth";
import {
  createCore,
  type CollectionSchema,
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
  A extends AuthConfig | undefined = undefined,
> {
  collections: T;
  globals?: G;
  adapter: StoreAdapter;
  /** Options for the HTTP handler exposed as `app.handler`. See `@shuri/api`'s `createApiHandler`. */
  api?: CreateApiHandlerOptions;
  /** Options for the globals HTTP handler exposed as `app.handler`. See `@shuri/api`'s `createGlobalsApiHandler`. */
  globalsApi?: CreateGlobalsApiHandlerOptions;
  /** Options for the event stream exposed on `app.handler`. See `@shuri/api`'s `createRealtimeHandler`. */
  realtime?: CreateRealtimeHandlerOptions;
  /** Options for the OpenAPI document/docs page exposed on `app.handler`. See `@shuri/api`'s `createOpenApiHandler`. */
  openapi?: CreateOpenApiHandlerOptions;
  /**
   * Turns authentication on. Declaring it merges `@shuri/auth`'s four collections into the schema,
   * mounts its routes ahead of every built-in one, and exposes `app.auth`. Omitting it leaves the
   * app exactly as it was, `app.auth` included — which is `undefined`.
   */
  auth?: A;
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
 * collection and global over HTTP, plus the change event stream (`/events`), the OpenAPI document
 * (`/openapi.json`) and a docs page (`/docs`) describing them:
 *
 *   const app = create({ collections, globals, adapter });
 *   Deno.serve(app.handler);
 *   // or: Bun.serve({ fetch: app.handler });
 *   // or, mounted in Hono: honoApp.all("/collections/*", (c) => app.handler(c.req.raw));
 */
export interface ShuriApp<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
  A extends AuthConfig | undefined = AuthConfig | undefined,
> {
  collections: AppCollections<T>;
  globals: AppGlobals<G>;
  /**
   * The auth service, present exactly when `config.auth` was. `A` is naked in the conditional, so it
   * distributes: no `auth` gives `undefined`, an object literal gives `AuthApi`, and an
   * `AuthConfig | undefined` variable gives `AuthApi | undefined`.
   *
   * Auth's own collections deliberately stay off `app.collections`: `app.collections._sessions
   * .insert(...)` would walk straight past every invariant sessions have, and the extra keys would
   * collide with a consumer's own slugs in the type.
   */
  auth: A extends AuthConfig ? AuthApi : undefined;
  handler: (request: Request) => Promise<Response>;
}

/**
 * Resolves one `CollectionStore` per declared slug, e.g. `collections.posts`.
 *
 * Driven by the **consumer's own** collections, not by `core.collections`: with auth on, the core
 * also holds `users`, `_sessions` and `_accounts`, and iterating it would put three keys on the
 * runtime object that the type never declares. Typed access to those goes through `app.auth`.
 * @param collections - The consumer's declared collections.
 * @param store - The store to resolve each collection's `CollectionStore` from.
 * @returns One `CollectionStore` per declared slug.
 */
function buildCollections<
  C extends readonly CollectionSchema[],
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(collections: C, store: Pick<Store<T, G>, "collection">): AppCollections<C> {
  const resolved: Record<string, unknown> = {};
  for (const collection of collections) {
    resolved[collection.slug] = store.collection(collection.slug as never);
  }
  return resolved as AppCollections<C>;
}

/**
 * Resolves one `GlobalStore` per declared slug, e.g. `globals.site`.
 * @param globals - The consumer's declared globals.
 * @param store - The store to resolve each global's `GlobalStore` from.
 * @returns One `GlobalStore` per declared slug.
 */
function buildGlobals<
  Gl extends readonly GlobalSchema[],
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(globals: Gl, store: Pick<Store<T, G>, "global">): AppGlobals<Gl> {
  const resolved: Record<string, unknown> = {};
  for (const global of globals) {
    resolved[global.slug] = store.global(global.slug as never);
  }
  return resolved as AppGlobals<Gl>;
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
  A extends AuthConfig | undefined = undefined,
>(config: CreateConfig<T, G, A>): ShuriApp<T, G, A> {
  // The apparent circularity — the handler needs the store, the store needs the core, the core needs
  // auth's collections — dissolves because `@shuri/auth` is two separable things: a static constant
  // of schemas, and a service bound to a store. The constant goes in first, the service comes last.
  if (config.auth) assertNoAuthSlugCollision(config.collections);
  const collections = (config.auth
    ? [...authCollections, ...config.collections]
    : config.collections) as unknown as T;

  const core = createCore({ collections, globals: config.globals as G });
  const store = createStore(core, config.adapter);
  const auth = config.auth ? createAuth({ store, ...config.auth }) : undefined;

  return {
    collections: buildCollections(config.collections, store),
    globals: buildGlobals((config.globals ?? []) as G, store),
    auth: auth as ShuriApp<T, G, A>["auth"],
    handler: createHandler(
      { core, store },
      {
        handlers: auth ? [auth.handler] : undefined,
        api: config.api,
        globalsApi: config.globalsApi,
        realtime: config.realtime,
        openapi: config.openapi,
      },
    ),
  };
}
