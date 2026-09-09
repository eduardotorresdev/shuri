import { createMemoryAdapter } from "@shuri/store-memory";
import { describe, expect, it } from "vitest";
import { create } from "../create.js";

const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [{ type: "text", name: "title" }],
  },
] as const;

describe("create({ handlers })", () => {
  it("mounts an extra handler ahead of every built-in one", async () => {
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      handlers: [async () => new Response("mine", { status: 200 })],
    });

    const response = await app.handler(new Request("http://x/collections/posts"));

    expect(await response.text()).toBe("mine");
  });

  it("leaves the built-in routes alone for a request it declines", async () => {
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      handlers: [async () => undefined],
    });

    const response = await app.handler(new Request("http://x/collections/posts"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("runs them before auth's, so one of them can guard it", async () => {
    const seen: string[] = [];
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      auth: {},
      handlers: [
        async (request) => {
          seen.push(new URL(request.url).pathname);
          return new Response(null, { status: 401 });
        },
      ],
    });

    const response = await app.handler(
      new Request("http://x/auth/login", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(seen).toEqual(["/auth/login"]);
  });
});

describe("create({ handlers }) as a function", () => {
  it("hands the built auth service to a handler that needs it", async () => {
    let received: unknown;
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      auth: {},
      handlers: ({ auth }) => {
        received = auth;
        return [];
      },
    });

    expect(received).toBe(app.auth);
    expect(typeof (received as { getSession?: unknown }).getSession).toBe("function");
  });

  it("gives `undefined` when auth is off, matching app.auth", () => {
    let received: unknown = "untouched";
    create({
      collections,
      adapter: createMemoryAdapter(),
      handlers: ({ auth }) => {
        received = auth;
        return [];
      },
    });

    expect(received).toBeUndefined();
  });

  it("mounts what the function returns, ahead of the built-in routes", async () => {
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      handlers: () => [async () => new Response("mine")],
    });

    const response = await app.handler(new Request("http://x/collections/posts"));

    expect(await response.text()).toBe("mine");
  });

  it("lets a guard built from that auth refuse a request the auth routes still answer", async () => {
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      auth: {},
      handlers: ({ auth }) => [
        async (request) =>
          new URL(request.url).pathname.startsWith("/collections") &&
          !(await auth.getSession(request))
            ? new Response(null, { status: 401 })
            : undefined,
      ],
    });

    expect((await app.handler(new Request("http://x/collections/posts"))).status).toBe(
      401,
    );
    // Signup still works: the guard declines it, so auth's own handler gets its turn.
    const signup = await app.handler(
      new Request("http://x/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ada@example.com",
          password: "correct horse battery",
        }),
      }),
    );
    expect(signup.status).toBe(201);
  });
});

describe("create({ plugins })", () => {
  const extra = {
    slug: "widgets",
    title: "Widgets",
    singular: "Widget",
    plural: "Widgets",
    fields: [{ type: "text", name: "label" }],
  } as const;

  it("merges a plugin's collections into the schema", async () => {
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      plugins: [{ name: "widgets", collections: [extra] }],
    });

    const response = await app.handler(new Request("http://x/collections/widgets"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("keeps them off app.collections, as auth's are kept off", () => {
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      plugins: [{ name: "widgets", collections: [extra] }],
    });

    expect(Object.keys(app.collections)).toEqual(["posts"]);
  });

  it("hands the plugin the store its collections live in", async () => {
    let seen: string[] = [];
    create({
      collections,
      adapter: createMemoryAdapter(),
      plugins: [
        {
          name: "widgets",
          collections: [extra],
          handlers({ store }) {
            seen = [store.collection("widgets" as never).schema.slug];
            return [];
          },
        },
      ],
    });

    expect(seen).toEqual(["widgets"]);
  });

  it("hands it the auth service too, so a guard can be built from it", () => {
    let seen: unknown;
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      auth: {},
      plugins: [
        {
          name: "guard",
          handlers({ auth }) {
            seen = auth;
            return [];
          },
        },
      ],
    });

    expect(seen).toBe(app.auth);
  });

  it("mounts plugin handlers ahead of the built-in routes", async () => {
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      plugins: [{ name: "mine", handlers: () => [async () => new Response("mine")] }],
    });

    const response = await app.handler(new Request("http://x/collections/posts"));

    expect(await response.text()).toBe("mine");
  });

  it("runs plain `handlers` before plugin ones, so a guard still guards them", async () => {
    const order: string[] = [];
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      handlers: [
        async () => {
          order.push("handler");
          return undefined;
        },
      ],
      plugins: [
        {
          name: "mine",
          handlers: () => [
            async () => {
              order.push("plugin");
              return undefined;
            },
          ],
        },
      ],
    });

    await app.handler(new Request("http://x/collections/posts"));

    expect(order).toEqual(["handler", "plugin"]);
  });

  it("refuses a plugin collection whose slug the app already uses", () => {
    expect(() =>
      create({
        collections,
        adapter: createMemoryAdapter(),
        plugins: [{ name: "clash", collections: [{ ...extra, slug: "posts" }] }],
      }),
    ).toThrow(/Plugin "clash"/);
  });
});
