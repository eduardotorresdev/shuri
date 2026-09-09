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
});

const principal = async () => ({ kind: "anonymous" as const });

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

  it("turns access control on when a plugin resolves the principal", async () => {
    const app = create({
      collections,
      adapter: createMemoryAdapter(),
      plugins: [
        {
          name: "auth",
          principal: async (request) =>
            request.headers.get("authorization") === "Bearer ada"
              ? { kind: "user", user: { id: "u1" } }
              : { kind: "anonymous" },
        },
      ],
    });

    // `posts` declares no rule, so with a principal resolver on it takes a signed-in one.
    expect((await app.handler(new Request("http://x/collections/posts"))).status).toBe(
      401,
    );
    expect(
      (
        await app.handler(
          new Request("http://x/collections/posts", {
            headers: { authorization: "Bearer ada" },
          }),
        )
      ).status,
    ).toBe(200);
  });

  it("refuses two plugins each resolving a principal", () => {
    expect(() =>
      create({
        collections,
        adapter: createMemoryAdapter(),
        plugins: [
          { name: "one", principal },
          { name: "two", principal },
        ],
      }),
    ).toThrow(/"one" and "two"/);
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
