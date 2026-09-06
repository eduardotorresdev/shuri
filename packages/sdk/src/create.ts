import {
  createHandler,
  type CreateApiHandlerOptions,
  type FallingHandler,
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
  collectPluginCollections,
  type PluginContext,
  type ShuriPlugin,
} from "./plugin.js";
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
  /**
   * Extra handlers mounted ahead of every built-in one, each answering a request or declining it so
   * the next gets its turn (see `@shuri/api`'s `FallingHandler`). This is where a surface that isn't
   * part of the core toolkit goes — `@shuri/ui`'s admin, a webhook receiver, an access guard.
   *
   * They run in the order given, before auth's own, so a guard listed first really does guard the
   * rest:
   *
   *   handlers: [requireApiKey, createAdminHandler({ collections, globals })]
   *
   * A **function** instead, when a handler needs something this call builds — the `AuthApi`, most
   * of all, which cannot exist before the store does and so cannot be passed in from outside:
   *
   *   handlers: ({ auth }) => [createAdminHandler({ collections, globals }, { auth: { auth } })]
   *
   * An array and a function tell themselves apart, so both forms are accepted with no wrapper.
   */
  handlers?:
    | readonly FallingHandler[]
    | ((context: HandlerContext<A>) => readonly FallingHandler[]);
  /**
   * Plugins contributing **collections** as well as handlers — see `ShuriPlugin`.
   *
   * Use this over `handlers` when a thing persists into the app's own store: its collections have to
   * be in the schema before the store is built, and its handlers need that store once it is.
   * `handlers` stays the simpler option when a plain handler is all you have.
   *
   *   plugins: [betterAuthPlugin({ options })]
   *
   * Plugin collections are merged into the schema but kept off `app.collections`, exactly as auth's
   * are.
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
  /**
   * Turns authentication on. Declaring it merges `@shuri/auth`'s four collections into the schema,
   * mounts its routes ahead of every built-in one, and exposes `app.auth`. Omitting it leaves the
   * app exactly as it was, `app.auth` included — which is `undefined`.
   */
  auth?: A;
}

/**
 * What a `handlers` function receives: everything `create()` builds that a handler might need but
 * cannot construct itself.
 *
 * One property today. It is an object rather than the `AuthApi` alone so that adding the next thing
 * a handler turns out to need is not a breaking change to every host that uses this.
 */
export interface HandlerContext<
  A extends AuthConfig | undefined = AuthConfig | undefined,
> {
  /** The auth service, present exactly when `config.auth` was — the same value as `app.auth`. */
  auth: A extends AuthConfig ? AuthApi : undefined;
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
/**
 * Resolves `config.handlers` to a plain array, calling it with the handler context when it is a
 * function.
 * @param handlers - The declared handlers, an array or a function of the context.
 * @param auth - The auth service to expose on the context, `undefined` when auth is off.
 * @returns The handlers to mount, empty when none were declared.
 */
function resolveHandlers<A extends AuthConfig | undefined>(
  handlers: CreateConfig<never[], never[], A>["handlers"],
  auth: HandlerContext<A>["auth"],
): readonly FallingHandler[] {
  if (!handlers) return [];
  // `typeof`, not `Array.isArray`: the latter's guard is `arg is any[]`, which a `readonly` array
  // does not match, so it narrows neither branch of this union.
  return typeof handlers === "function" ? handlers({ auth }) : handlers;
}

/**
 * Resolves every plugin's handlers, in declaration order.
 * @param plugins - The declared plugins.
 * @param context - The store and auth service to hand each one.
 * @returns Every plugin handler, flattened, in plugin order.
 */
function resolvePluginHandlers(
  plugins: readonly ShuriPlugin[],
  context: PluginContext,
): readonly FallingHandler[] {
  return plugins.flatMap((plugin) => plugin.handlers?.(context) ?? []);
}

export function create<
  const T extends readonly CollectionSchema[],
  const G extends readonly GlobalSchema[] = [],
  A extends AuthConfig | undefined = undefined,
>(config: CreateConfig<T, G, A>): ShuriApp<T, G, A> {
  // The apparent circularity — the handler needs the store, the store needs the core, the core needs
  // auth's collections — dissolves because `@shuri/auth` is two separable things: a static constant
  // of schemas, and a service bound to a store. The constant goes in first, the service comes last.
  if (config.auth) assertNoAuthSlugCollision(config.collections);

  const plugins = config.plugins ?? [];
  const base = config.auth
    ? [...authCollections, ...config.collections]
    : config.collections;
  const pluginCollections = collectPluginCollections(
    plugins,
    new Set(base.map((collection) => collection.slug)),
  );
  const collections = [...pluginCollections, ...base] as unknown as T;

  const core = createCore({ collections, globals: config.globals as G });
  const store = createStore(core, config.adapter);
  const auth = config.auth ? createAuth({ store, ...config.auth }) : undefined;
  const appAuth = auth as ShuriApp<T, G, A>["auth"];

  return {
    collections: buildCollections(config.collections, store),
    globals: buildGlobals((config.globals ?? []) as G, store),
    auth: appAuth,
    handler: createHandler(
      { core, store },
      {
        // Auth's handler goes last of the three: a guard passed in `config.handlers` has to run
        // before the routes that issue sessions — but never *instead* of them, or signing in would
        // be refused for want of the very session it hands out.
        handlers: [
          ...resolveHandlers(config.handlers, appAuth),
          ...resolvePluginHandlers(plugins, { store, auth } as unknown as PluginContext),
          ...(auth ? [auth.handler] : []),
        ],
        api: config.api,
        globalsApi: config.globalsApi,
        realtime: config.realtime,
        openapi: config.openapi,
      },
    ),
  };
}
