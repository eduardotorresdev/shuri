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

    const post = await app.collections.posts.insert({ title: "Hello", status: "draft" });

    expect(post).toMatchObject({ title: "Hello", status: "draft" });
    expect(await app.collections.posts.findOne(post.id)).toEqual(post);
    expect(app.core.getCollection("posts")).toBe(collections[0]);
  });

  it("rejects an insert that doesn't satisfy the collection's fields, same as the API would", async () => {
    const app = createApp();
    await expect(app.collections.posts.insert({ status: "draft" } as never)).rejects.toThrow(RecordValidationError);
  });

  it("exposes the same collection through app.collections.<slug> and app.store.collection()", () => {
    const app = createApp();
    expect(app.collections.posts).toBe(app.store.collection("posts"));
  });

  it("exposes a handler serving app.store's collections over HTTP", async () => {
    const app = createApp();
    const response = await app.handler(
      new Request("http://localhost/collections/posts", {
        method: "POST",
        body: JSON.stringify({ title: "Hello", status: "draft" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ title: "Hello", status: "draft" });
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

    // These are invalid at the type level only; the runtime rejection (from the store's own field
    // validation) is expected too, so it's caught here just to keep the promise from going unhandled.
    // @ts-expect-error "status" is required
    app.collections.posts.insert({ title: "Hello" }).catch(() => {});
    // @ts-expect-error "status" only accepts declared option values
    app.collections.posts.insert({ title: "Hello", status: "archived" }).catch(() => {});
    // @ts-expect-error "views" is a number field
    app.collections.posts.insert({ title: "Hello", status: "draft", views: "many" }).catch(() => {});
    // @ts-expect-error unknown field
    app.collections.posts.insert({ title: "Hello", status: "draft", unknownField: true }).catch(() => {});
  });
});
