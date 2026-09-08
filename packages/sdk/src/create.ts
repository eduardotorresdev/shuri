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
  derivedScopes,
  type CollectionHook,
  type CollectionHookName,
  type CollectionSchema,
  type GlobalHook,
  type GlobalHookName,
  type GlobalSchema,
  type HookRecord,
  type InferCollection,
  type InferCollections,
  type InferGlobal,
  type InferGlobals,
} from "@shuri/core";
import {
  createStore,
  type CollectionStore,
  type GlobalStore,
  type HookRegistry,
  type Store,
  type StoreAdapter,
  type Unsubscribe,
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
   * Turns authentication on. Declaring it merges `@shuri/auth`'s six collections into the schema,
   * mounts its routes ahead of every built-in one, exposes `app.auth`, and turns the `access` rules
   * of every collection and global on (an op with no rule needs a signed-in principal). Omitting it
   * leaves the app exactly as it was, `app.auth` included — which is `undefined` — and every route
   * open.
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

/** The record shape a hook on `S` sees: the slug's inferred record, or the generic one for `"*"`. */
type HookRecordFor<Records, S extends string> = S extends "*"
  ? HookRecord
  : S extends keyof Records
    ? Records[S]
    : HookRecord;

/**
 * Programmatic hook registration, typed from the schema: `app.hooks.onCollection("posts",
 * "afterChange", ({ doc }) => ...)` narrows `doc` to the `posts` record shape, and `"*"` (every
 * collection/global) falls back to the generic one. A thin facade over `store.hooks`, the
 * PocketBase side of the same mechanism the schema's `hooks` property is the Payload side of: the
 * schema's hooks run first, then these, in registration order. Returns the unsubscribe function.
 */
export interface AppHooks<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
> {
  onCollection<S extends T[number]["slug"] | "*", N extends CollectionHookName>(
    slug: S,
    name: N,
    hook: CollectionHook<N, HookRecordFor<InferCollections<T>, S>>,
  ): Unsubscribe;
  onGlobal<S extends G[number]["slug"] | "*", N extends GlobalHookName>(
    slug: S,
    name: N,
    hook: GlobalHook<N, HookRecordFor<InferGlobals<G>, S>>,
  ): Unsubscribe;
}

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
  /** Registers lifecycle hooks at runtime, typed per slug. See `@shuri/core`'s `hooks/` for the vocabulary. */
  hooks: AppHooks<T, G>;
  /**
   * The consumer's own schema, exactly as declared (auth's collections excluded). Its *type* is what
   * `@shuri/client` is built from: `createClient<typeof app.schema>({ baseUrl })`.
   */
  schema: { collections: T; globals: G };
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
 * The typed facade over the store's registry. The hook a consumer passes is typed for one slug's
 * record while the registry stores the generic shape, so the cast at this one boundary is what lets
 * every call site stay fully typed.
 * @param hooks - The store's registry.
 * @returns The typed `app.hooks`.
 */
function buildHooks<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(hooks: HookRegistry): AppHooks<T, G> {
  return {
    onCollection: (slug, name, hook) => hooks.onCollection(slug, name, hook as never),
    onGlobal: (slug, name, hook) => hooks.onGlobal(slug, name, hook as never),
  };
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
  // `scopes` is what only the app knows: the concrete `<slug>:<op>` universe a client role expands
  // against. Derived from the merged core, so auth's own internal collections yield none.
  const auth = config.auth
    ? createAuth({
        store,
        scopes: derivedScopes(core.collections, core.globals),
        ...config.auth,
      })
    : undefined;

  return {
    collections: buildCollections(config.collections, store),
    globals: buildGlobals((config.globals ?? []) as G, store),
    auth: auth as ShuriApp<T, G, A>["auth"],
    hooks: buildHooks(store.hooks),
    schema: { collections: config.collections, globals: (config.globals ?? []) as G },
    handler: createHandler(
      { core, store },
      {
        handlers: auth ? [auth.handler] : undefined,
        access: auth ? { principal: auth.principal } : undefined,
        api: config.api,
        globalsApi: config.globalsApi,
        realtime: config.realtime,
        // The auth routes are mounted ahead of the built-in ones, so the document must learn about
        // them here — and about the cookie/bearer/client-credentials schemes every route accepts.
        openapi: auth
          ? {
              paths: auth.openapi.paths,
              security: auth.openapi.security,
              ...config.openapi,
            }
          : config.openapi,
      },
    ),
  };
}
