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

    const post = await app.collections.posts.insert({ title: "Hello", status: "draft" });

    expect(post).toMatchObject({ title: "Hello", status: "draft" });
    expect(await app.collections.posts.findOne(post.id)).toEqual(post);
    expect(app.core.getCollection("posts")).toBe(collections[0]);
  });

  it("exposes the same collection through app.collections.<slug> and app.store.collection()", () => {
    const app = createApp();
    expect(app.collections.posts).toBe(app.store.collection("posts"));
  });

  it("infers the record shape from each collection's fields (compile-time)", async () => {
    const app = createApp();

    // Required fields must be present, optional fields may be omitted, values must match the field type.
    const inserted = await app.collections.posts.insert({ title: "Hello", status: "draft" });
    const title: string = inserted.title;
    const status: "draft" | "published" = inserted.status;
    const views: number | undefined = inserted.views;
    const id: string = inserted.id;
    expect({ title, status, views, id }).toMatchObject({ title: "Hello", status: "draft" });

    // @ts-expect-error "status" is required
    app.collections.posts.insert({ title: "Hello" });
    // @ts-expect-error "status" only accepts declared option values
    app.collections.posts.insert({ title: "Hello", status: "archived" });
    // @ts-expect-error "views" is a number field
    app.collections.posts.insert({ title: "Hello", status: "draft", views: "many" });
    // @ts-expect-error unknown field
    app.collections.posts.insert({ title: "Hello", status: "draft", unknownField: true });
  });
});
