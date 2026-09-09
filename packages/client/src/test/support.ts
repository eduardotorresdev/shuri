import { apiKey } from "@better-auth/api-key";
import { betterAuthPlugin } from "@shuri/better-auth";
import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { createClient, type ClientConfig } from "../create.js";

/** The schema every integration test of this package shares, declared once so the client's types read off it. */
export const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    access: { list: () => true, view: () => true },
    fields: [
      { type: "text", name: "title", required: true },
      { type: "number", name: "views", kind: "integer", sign: "positive" },
      { type: "text", name: "secret", hidden: true },
    ],
  },
] as const;

export const globals = [
  {
    slug: "site",
    title: "Site settings",
    category: { title: "Geral" },
    access: { read: () => true },
    fields: [{ type: "text", name: "name", required: true }],
  },
] as const;

export const credentials = {
  email: "ada@example.com",
  password: "correct-horse-battery",
};

/**
 * A real `create()` app and a client bound straight to its handler — no HTTP server, the client's
 * `fetch` is `app.handler` over a `Request` built from what the client sends.
 * @param options - Whether to turn auth on, and any client config to add.
 * @returns The app and the client talking to it.
 */
export function createTestApp(
  options: { auth?: boolean; client?: Partial<ClientConfig> } = {},
) {
  const auth = options.auth
    ? betterAuthPlugin({
        options: {
          baseURL: "http://localhost",
          secret: "test-secret-at-least-32-characters-long",
          emailAndPassword: { enabled: true },
          // Off under NODE_ENV=test by default, which would hide a client that sends no
          // Origin: the demo boot is where that surfaced.
          advanced: { disableOriginCheck: false },
          plugins: [apiKey()],
        },
      })
    : undefined;
  const app = create({
    collections,
    globals,
    adapter: createMemoryAdapter(),
    realtime: { heartbeatMs: 0 },
    ...(auth ? { plugins: [auth] } : {}),
  });
  const client = createClient<typeof app.schema>({
    baseUrl: "http://localhost",
    fetch: (input, init) => app.handler(new Request(input, init)),
    ...options.client,
  });
  return { app, client, auth };
}

/**
 * A promise with its `resolve` in hand (`Promise.withResolvers` needs a newer lib than ES2023).
 * @returns The promise and its resolver.
 */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Collects `count` events off a subscription, resolving once they arrived.
 * @param count - How many events to wait for.
 * @returns The collector and the promise of the collected events.
 */
export function collect<E>(count: number): {
  listener: (event: E) => void;
  events: Promise<E[]>;
} {
  const collected: E[] = [];
  const { promise, resolve } = deferred<E[]>();
  return {
    listener: (event) => {
      collected.push(event);
      if (collected.length === count) resolve(collected);
    },
    events: promise,
  };
}

/**
 * Waits for a subscription to be open before writing, so the write can't beat the stream.
 * @returns The `onOpen` callback to pass, and the promise it resolves.
 */
export function opened(): { onOpen: () => void; open: Promise<void> } {
  const { promise, resolve } = deferred<void>();
  return { onOpen: () => resolve(), open: promise };
}
