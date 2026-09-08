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

describe("app hooks", () => {
  it("runs a hook declared on the schema, before one registered on app.hooks", async () => {
    const order: string[] = [];
    const app = create({
      collections: [
        {
          ...collections[0],
          hooks: {
            beforeChange: [
              ({ data }) => {
                order.push("schema");
                // Typed over the generic record: a literal can't reference its own fields.
                return typeof data.title === "string"
                  ? { ...data, title: data.title.trim() }
                  : undefined;
              },
            ],
          },
        },
      ] as const,
      adapter: createMemoryAdapter(),
    });
    app.hooks.onCollection("posts", "beforeChange", ({ data }) => {
      order.push(`registered:${String(data.title)}`);
    });

    const post = await app.collections.posts.insert({
      title: "  Hello ",
      status: "draft",
    });

    expect(post.title).toBe("Hello");
    expect(order).toEqual(["schema", "registered:Hello"]);
  });

  it("types a registered hook per slug (compile-time), and stops it once unsubscribed", async () => {
    const app = createApp();
    const seen: string[] = [];
    const unsubscribe = app.hooks.onCollection(
      "posts",
      "afterChange",
      ({ doc, operation }) => {
        const title: string = doc.title;
        const status: "draft" | "published" = doc.status;
        const id: string = doc.id;
        seen.push(`${operation}:${title}:${status}:${id.length > 0}`);
      },
    );
    app.hooks.onCollection("posts", "afterDelete", ({ id, doc }) => {
      seen.push(`delete:${id === doc?.id}`);
    });

    const post = await app.collections.posts.insert({ title: "Hello", status: "draft" });
    await app.collections.posts.update(post.id, { title: "Hello again" });
    unsubscribe();
    await app.collections.posts.update(post.id, { title: "Unseen" });
    await app.collections.posts.delete(post.id);

    expect(seen).toEqual([
      "create:Hello:draft:true",
      "update:Hello again:draft:true",
      "delete:true",
    ]);

    app.hooks.onCollection("posts", "afterChange", ({ doc }) => {
      // @ts-expect-error a hook on "posts" sees that collection's fields only
      void doc.unknownField;
    });
    // @ts-expect-error a slug the app doesn't declare
    app.hooks.onCollection("nope", "afterChange", () => {});
    // @ts-expect-error a hook name that doesn't exist
    app.hooks.onCollection("posts", "onSave", () => {});
    // @ts-expect-error `subscribe` is gone from the store: reacting is a hook, observing is @shuri/client
    void app.collections.posts.subscribe;
  });

  it("delivers a global's updates to a global hook, and the generic record to a wildcard one", async () => {
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
    app.hooks.onGlobal("site", "afterChange", ({ doc, previousDoc }) => {
      names.push(`${previousDoc.name ?? "-"}->${doc.name}`);
    });
    app.hooks.onGlobal("*", "afterChange", ({ global, doc }) => {
      names.push(`${global}:${String(doc.name)}`);
    });

    await app.globals.site.update({ name: "Acme" });
    await app.globals.site.update({ name: "Acme Co" });

    expect(names).toEqual(["-->Acme", "site:Acme", "Acme->Acme Co", "site:Acme Co"]);
  });
});
