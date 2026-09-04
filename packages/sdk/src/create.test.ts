import { RecordValidationError } from "@shuri/store";
import { createMemoryAdapter } from "@shuri/store-memory";
import { describe, expect, it } from "vitest";
import { create } from "./create.js";

const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [
      { type: "text", name: "title", required: true },
      { type: "number", name: "views", kind: "integer", sign: "positive" },
      {
        type: "select",
        name: "status",
        required: true,
        options: [
          { label: "Draft", value: "draft" },
          { label: "Published", value: "published" },
        ],
      },
    ],
  },
] as const;

function createApp() {
  return create({ collections, adapter: createMemoryAdapter() });
}

describe("create", () => {
  it("wires collections and adapter into a working store", async () => {
    const app = createApp();

    const post = await app.collections.posts.insert({
      title: "Hello",
      status: "draft",
    });

    expect(post).toMatchObject({ title: "Hello", status: "draft" });
    expect(await app.collections.posts.findOne(post.id)).toEqual(post);
  });

  it("rejects an insert that doesn't satisfy the collection's fields, same as the API would", async () => {
    const app = createApp();
    await expect(
      app.collections.posts.insert({ status: "draft" } as never),
    ).rejects.toThrow(RecordValidationError);
  });

  it("exposes a handler serving the app's collections over HTTP", async () => {
    const app = createApp();
    const response = await app.handler(
      new Request("http://localhost/collections/posts", {
        method: "POST",
        body: JSON.stringify({ title: "Hello", status: "draft" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      title: "Hello",
      status: "draft",
    });
  });

  it("wires globals and adapter into a working store", async () => {
    const app = create({
      collections,
      globals: [
        {
          slug: "site",
          title: "Site settings",
          category: { title: "Geral" },
          fields: [{ type: "text", name: "name", required: true }],
        },
      ] as const,
      adapter: createMemoryAdapter(),
    });

    expect(await app.globals.site.get()).toEqual({});
    const updated = await app.globals.site.update({ name: "Acme" });
    expect(updated).toEqual({ name: "Acme" });
    expect(await app.globals.site.get()).toEqual({ name: "Acme" });
  });

  it("infers the record shape from each collection's fields (compile-time)", async () => {
    const app = createApp();

    // Required fields must be present, optional fields may be omitted, values must match the field type.
    const inserted = await app.collections.posts.insert({
      title: "Hello",
      status: "draft",
    });
    const title: string = inserted.title;
    const status: "draft" | "published" = inserted.status;
    const views: number | undefined = inserted.views;
    const id: string = inserted.id;
    expect({ title, status, views, id }).toMatchObject({
      title: "Hello",
      status: "draft",
    });

    // These are invalid at the type level only; the runtime rejection (from the store's own field
    // validation) is expected too, so it's caught here just to keep the promise from going unhandled.
    // @ts-expect-error "status" is required
    app.collections.posts.insert({ title: "Hello" }).catch(() => {});

    app.collections.posts
      // @ts-expect-error "status" only accepts declared option values
      .insert({ title: "Hello", status: "archived" })
      .catch(() => {});

    app.collections.posts
      // @ts-expect-error "views" is a number field
      .insert({ title: "Hello", status: "draft", views: "many" })
      .catch(() => {});

    app.collections.posts
      // @ts-expect-error unknown field
      .insert({ title: "Hello", status: "draft", unknownField: true })
      .catch(() => {});
  });
});

describe("app subscriptions", () => {
  it("delivers a collection's own events, typed from its fields (compile-time)", async () => {
    const app = createApp();
    const seen: string[] = [];

    app.collections.posts.subscribe((event) => {
      seen.push(event.type);
      // A delete event carries no record, so `record` is only reachable after narrowing by `type`.
      if (event.type === "delete") return;
      const title: string = event.record.title;
      const status: "draft" | "published" = event.record.status;
      expect({ title, status }).toEqual({ title: "Hello", status: "draft" });
    });

    const post = await app.collections.posts.insert({
      title: "Hello",
      status: "draft",
    });
    await app.collections.posts.delete(post.id);

    expect(seen).toEqual(["create", "delete"]);
  });

  it("delivers only updates and deletes to a per-record subscription", async () => {
    const app = createApp();
    const post = await app.collections.posts.insert({
      title: "Hello",
      status: "draft",
    });
    const seen: string[] = [];
    app.collections.posts.subscribe(post.id, (event) => {
      seen.push(event.type);
      // @ts-expect-error a delete event carries no record, so the union has no common `record`
      void event.record;
    });

    await app.collections.posts.insert({ title: "Another", status: "draft" });
    await app.collections.posts.update(post.id, { title: "Hello again" });
    await app.collections.posts.delete(post.id);

    expect(seen).toEqual(["update", "delete"]);
  });

  it("stops delivering once unsubscribed, and delivers a global's updates", async () => {
    const app = create({
      collections,
      globals: [
        {
          slug: "site",
          title: "Site settings",
          category: { title: "Geral" },
          fields: [{ type: "text", name: "name", required: true }],
        },
      ] as const,
      adapter: createMemoryAdapter(),
    });
    const names: (string | undefined)[] = [];
    const unsubscribe = app.globals.site.subscribe((event) => {
      names.push(event.record.name);
    });

    await app.globals.site.update({ name: "Acme" });
    unsubscribe();
    await app.globals.site.update({ name: "Acme Co" });

    expect(names).toEqual(["Acme"]);
  });
});

describe("create with auth", () => {
  function authApp() {
    return create({
      collections,
      adapter: createMemoryAdapter(),
      auth: { cookie: { secure: false } },
      realtime: { heartbeatMs: 0 },
    });
  }

  it("exposes app.auth and leaves app.collections to the consumer's own slugs", () => {
    const app = authApp();

    expect(Object.keys(app.collections)).toEqual(["posts"]);
    expect(app.auth.getSession).toBeTypeOf("function");
  });

  it("is undefined without an auth config, at runtime and in the type", () => {
    const app = create({ collections, adapter: createMemoryAdapter() });

    expect(app.auth).toBeUndefined();
    // @ts-expect-error — `app.auth` is `undefined` here, so it has no members to reach for.
    expect(() => app.auth.getSession).toThrow();
  });

  it("serves the auth routes ahead of every built-in one", async () => {
    const app = authApp();

    const signup = await app.handler(
      new Request("http://localhost/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ada@example.com",
          password: "correct-horse-battery",
        }),
      }),
    );

    expect(signup.status).toBe(201);
    expect(await signup.json()).toMatchObject({ user: { email: "ada@example.com" } });
  });

  it("keeps the auth collections off HTTP while auth itself uses them", async () => {
    const app = authApp();
    await app.auth.signUp({
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    const users = await app.handler(new Request("http://localhost/collections/users"));
    const unknown = await app.handler(new Request("http://localhost/collections/nope"));

    expect(users.status).toBe(404);
    expect(await users.json()).toEqual({ error: 'Unknown collection "users"' });
    expect(await unknown.json()).toEqual({ error: 'Unknown collection "nope"' });
  });

  it("refuses a consumer collection reusing a slug @shuri/auth owns", () => {
    expect(() =>
      create({
        collections: [
          {
            slug: "users",
            title: "Users",
            singular: "User",
            plural: "Users",
            fields: [{ type: "text", name: "name" }],
          },
        ] as const,
        adapter: createMemoryAdapter(),
        auth: {},
      }),
    ).toThrow(/reserved by @shuri\/auth/);
  });
});
