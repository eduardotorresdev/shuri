import {
  createHandler,
  type CreateApiHandlerOptions,
  type CreateGlobalsApiHandlerOptions,
  type CreateOpenApiHandlerOptions,
  type CreateRealtimeHandlerOptions,
  type FallingHandler,
} from "@shuri/api";
import {
  createCore,
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
import {
  collectPluginAccess,
  collectPluginCollections,
  collectPluginOpenApi,
  type PluginContext,
  type ShuriPlugin,
} from "./plugin.js";

export interface CreateConfig<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[] = [],
> {
  collections: T;
  globals?: G;
  adapter: StoreAdapter;
  /**
   * Extra handlers mounted ahead of every built-in one, each answering a request or declining it so
   * the next gets its turn (see `@shuri/api`'s `FallingHandler`). This is where a surface that isn't
   * part of the core toolkit goes — a webhook receiver, an access guard.
   *
   * They run in the order given, before every plugin's own, so a guard listed here really does
   * guard them:
   *
   *   handlers: [requireApiKey]
   *
   * A handler that needs the store, or that brings collections of its own, is a plugin instead.
   */
  handlers?: readonly FallingHandler[];
  /**
   * Plugins contributing **collections**, **handlers** and, for an auth plugin, the **principal**
   * behind each request — see `ShuriPlugin`.
   *
   * Use this over `handlers` when a thing persists into the app's own store: its collections have to
   * be in the schema before the store is built, and its handlers need that store once it is.
   *
   *   plugins: [betterAuthPlugin({ options })]
   *
   * Plugin collections are merged into the schema but kept off `app.collections`.
   */
  plugins?: readonly ShuriPlugin[];
  /** Options for the HTTP handler exposed as `app.handler`. See `@shuri/api`'s `createApiHandler`. */
  api?: CreateApiHandlerOptions;
  /** Options for the globals HTTP handler exposed as `app.handler`. See `@shuri/api`'s `createGlobalsApiHandler`. */
  globalsApi?: CreateGlobalsApiHandlerOptions;
  /** Options for the event stream exposed on `app.handler`. See `@shuri/api`'s `createRealtimeHandler`. */
  realtime?: CreateRealtimeHandlerOptions;
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
> {
  collections: AppCollections<T>;
  globals: AppGlobals<G>;
  /** Registers lifecycle hooks at runtime, typed per slug. See `@shuri/core`'s `hooks/` for the vocabulary. */
  hooks: AppHooks<T, G>;
  /**
   * The consumer's own schema, exactly as declared (plugin collections excluded). Its *type* is
   * what `@shuri/client` is built from: `createClient<typeof app.schema>({ baseUrl })`.
   */
  schema: { collections: T; globals: G };
  handler: (request: Request) => Promise<Response>;
}

/**
 * Resolves one `CollectionStore` per declared slug, e.g. `collections.posts`.
 *
 * Driven by the **consumer's own** collections, not by `core.collections`: with an auth plugin on,
 * the core also holds its `user`, `session` and `account` tables, and iterating it would put keys
 * on the runtime object that the type never declares.
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
 *
 * The apparent circularity — the handler needs the store, the store needs the core, the core needs
 * every plugin's collections — dissolves because a plugin is two separable things: a static list of
 * schemas, and handlers bound to a store. The list goes in first, the handlers come last.
 * @param config - The collections/globals schema, persistence adapter, plugins and handler options.
 * @returns The app facade tying `config.collections`/`config.globals` to `config.adapter`.
 */
export function create<
  const T extends readonly CollectionSchema[],
  const G extends readonly GlobalSchema[] = [],
>(config: CreateConfig<T, G>): ShuriApp<T, G> {
  const plugins = config.plugins ?? [];
  const pluginCollections = collectPluginCollections(
    plugins,
    new Set(config.collections.map((collection) => collection.slug)),
  );
  const collections = [...pluginCollections, ...config.collections] as unknown as T;
  const globals = (config.globals ?? []) as G;

  const core = createCore({ collections, globals });
  const store = createStore(core, config.adapter);
  const context = { store } as unknown as PluginContext;

  return {
    collections: buildCollections(config.collections, store),
    globals: buildGlobals(globals, store),
    hooks: buildHooks(store.hooks),
    schema: { collections: config.collections, globals },
    handler: createHandler(
      { core, store },
      {
        // Plain handlers first: a guard passed there has to run before the routes that issue
        // sessions — but never *instead* of them, or signing in would be refused for want of the
        // very session it hands out.
        handlers: [
          ...(config.handlers ?? []),
          ...plugins.flatMap((plugin) => plugin.handlers?.(context) ?? []),
        ],
        // The one plugin resolving a principal is what turns every `access` rule on.
        access: collectPluginAccess(plugins),
        api: config.api,
        globalsApi: config.globalsApi,
        realtime: config.realtime,
        // A plugin's routes are mounted ahead of the built-in ones, so the document must learn about
        // them here — and about how requests authenticate. A host's own `openapi` options win.
        openapi: { ...collectPluginOpenApi(plugins), ...config.openapi },
      },
    ),
  };
}
