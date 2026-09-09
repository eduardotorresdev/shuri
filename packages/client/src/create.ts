import type {
  CollectionSchema,
  GlobalSchema,
  InferCollections,
  InferGlobals,
} from "@shuri/core";
import { authClient, type AuthClient } from "./auth.js";
import { collectionClient, type CollectionClient } from "./collections.js";
import { globalClient, type GlobalClient } from "./globals.js";
import { createHttp, type FetchLike } from "./http.js";
import {
  subscribe,
  type EventSelection,
  type RealtimeMessage,
  type SubscribeOptions,
  type Unsubscribe,
} from "./realtime/subscribe.js";

export interface ClientPaths {
  /** Where the collections are mounted. Defaults to "/collections". */
  collections?: string;
  /** Where the globals are mounted. Defaults to "/globals". */
  globals?: string;
  /** Where the auth routes are mounted. Defaults to "/api/auth", which is better-auth's. */
  auth?: string;
  /** Where the event stream is mounted. Defaults to "/events". */
  events?: string;
}

export interface ClientConfig {
  /** The server's origin, with any prefix the app is mounted under (`https://host/api`). */
  baseUrl: string;
  /** The `fetch` to use; the global one by default. A test binds it to `app.handler` directly. */
  fetch?: FetchLike;
  /** A bearer token to send from the start (better-auth's `bearer` plugin, or a host's own scheme). */
  token?: string;
  /** The `credentials` mode of every request. Defaults to "include", so a browser rides on the session cookie. */
  credentials?: RequestCredentials;
  /** The base paths, when the server relocated any of its handlers. */
  paths?: ClientPaths;
}

/**
 * The shape the client is typed from: the app's own `{ collections, globals }` — `typeof
 * app.schema` in `@shuri/sdk`, or the two schema literals a server module exports. Only its type is
 * used; nothing about the schema exists at runtime on the client, which is what keeps hooks and
 * access rules (server functions) out of a browser bundle.
 */
export interface ClientSchema {
  collections: readonly CollectionSchema[];
  globals?: readonly GlobalSchema[];
}

/** One `CollectionClient` per declared slug, so `client.collections.posts.create(...)` is typed per that collection's fields. */
export type ClientCollections<T extends readonly CollectionSchema[]> = {
  [C in T[number] as C["slug"]]: CollectionClient<InferCollections<T>[C["slug"]]>;
};

/** One `GlobalClient` per declared slug, so `client.globals.site.get()` is typed per that global's fields. */
export type ClientGlobals<G extends readonly GlobalSchema[]> = {
  [Gl in G[number] as Gl["slug"]]: GlobalClient<InferGlobals<G>[Gl["slug"]]>;
};

/** The raw, untyped stream: the two typed `subscribe`s delegate to it. */
export interface RealtimeClient {
  subscribe(
    selection: EventSelection,
    listener: (message: RealtimeMessage) => void,
    options?: SubscribeOptions,
  ): Unsubscribe;
}

/**
 * The HTTP client of a Shuri app, shaped like `ShuriApp` on the other side: `client.collections
 * .posts` and `client.globals.site` are typed from the same schema the server was built with.
 */
export interface ShuriClient<S extends ClientSchema = ClientSchema> {
  collections: ClientCollections<S["collections"]>;
  globals: ClientGlobals<NonNullable<S["globals"]>>;
  auth: AuthClient;
  realtime: RealtimeClient;
}

/**
 * An object whose every property is built on first access and kept: the client knows the slugs
 * only as types, so the per-slug clients can't be enumerated up front the way `@shuri/sdk` does.
 * @param build - Builds the value for one key.
 * @returns The lazily populated object.
 */
function lazyRecord<V>(build: (key: string) => V): Record<string, V> {
  const cache = new Map<string, V>();
  return new Proxy({} as Record<string, V>, {
    get(_target, key) {
      if (typeof key !== "string") return undefined;
      let value = cache.get(key);
      if (value === undefined) {
        value = build(key);
        cache.set(key, value);
      }
      return value;
    },
  });
}

/**
 * Builds a client for the app at `baseUrl`, typed from `S`:
 *
 *   const client = createClient<typeof app.schema>({ baseUrl: "https://host" });
 *   await client.collections.posts.create({ title: "Hello" });
 *
 * `S` only shapes the types; nothing about the schema is downloaded or bundled.
 * @param config - The base URL, the `fetch` to use, and the ambient token/credentials/paths.
 * @returns The client.
 */
export function createClient<S extends ClientSchema = ClientSchema>(
  config: ClientConfig,
): ShuriClient<S> {
  const http = createHttp(config);
  const paths = {
    collections: config.paths?.collections ?? "/collections",
    globals: config.paths?.globals ?? "/globals",
    auth: config.paths?.auth ?? "/api/auth",
    events: config.paths?.events ?? "/events",
  };

  return {
    collections: lazyRecord((slug) => collectionClient(http, paths, slug)) as never,
    globals: lazyRecord((slug) => globalClient(http, paths, slug)) as never,
    auth: authClient(http, { basePath: paths.auth }),
    realtime: {
      subscribe: (selection, listener, options) =>
        subscribe(http, paths.events, selection, listener, options),
    },
  };
}
