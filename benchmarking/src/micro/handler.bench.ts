import { betterAuthPlugin } from "@shuri/better-auth";
import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { bench, describe } from "vitest";
import { collections, globals, samplePost } from "../sut/schema.ts";
import { seed } from "../sut/seed.ts";

/**
 * `app.handler(new Request(...))` in-process: the lib's own cost per request, with no socket, no
 * `node:http` and no `toNodeListener` in the way. Set against `get-record` in the load report, the
 * difference is the bridge.
 */
const POSTS = 10_000;
const SESSIONS = 1_000;

const open = create({ collections, globals, adapter: createMemoryAdapter() });
const openFixtures = await seed(open, { posts: POSTS, sessions: 0 });

const ba = betterAuthPlugin({
  options: {
    baseURL: "http://sut",
    secret: "bench-secret-at-least-32-characters-long",
    emailAndPassword: { enabled: true },
    advanced: { useSecureCookies: false },
  },
});
const auth = create({
  collections,
  globals,
  adapter: createMemoryAdapter(),
  plugins: [ba],
});
const authFixtures = await seed(auth, { posts: POSTS, sessions: SESSIONS, auth: ba });

/** Longer than tinybench's defaults: the seed leaves a heap full of garbage, and 500 ms of samples would be mostly its collection. */
const OPTIONS = { time: 2_000, warmupTime: 1_000 };

let i = 0;
const nextId = (ids: string[]): string => ids[i++ % ids.length] as string;
const insertBody = JSON.stringify(samplePost(1));

describe(`app.handler, memory adapter, ${POSTS} posts`, () => {
  bench(
    "GET /collections/posts/:id (auth off)",
    async () => {
      const response = await open.handler(
        new Request(`http://sut/collections/posts/${nextId(openFixtures.ids)}`),
      );
      await response.json();
    },
    OPTIONS,
  );

  bench(
    "GET /collections/posts?limit=20 (auth off)",
    async () => {
      const response = await open.handler(
        new Request("http://sut/collections/posts?limit=20"),
      );
      await response.json();
    },
    OPTIONS,
  );

  bench(
    "POST /collections/posts (auth off)",
    async () => {
      const response = await open.handler(
        new Request("http://sut/collections/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: insertBody,
        }),
      );
      await response.json();
    },
    OPTIONS,
  );

  bench(
    `GET /collections/posts/:id with session cookie (auth on, ${SESSIONS} sessions)`,
    async () => {
      const response = await auth.handler(
        new Request(`http://sut/collections/posts/${nextId(authFixtures.ids)}`, {
          headers: { cookie: authFixtures.sessionCookie ?? "" },
        }),
      );
      await response.json();
    },
    OPTIONS,
  );

  bench(
    "GET /collections/posts/:id anonymous (auth on)",
    async () => {
      const response = await auth.handler(
        new Request(`http://sut/collections/posts/${nextId(authFixtures.ids)}`),
      );
      await response.json();
    },
    OPTIONS,
  );
});
