import { describe, expect, it } from "vitest";
import type { AdminCollection } from "$shared/schema.js";
import { isSortable, listColumns } from "./columns.js";

const posts: AdminCollection = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  labelField: "title",
  fields: [
    { type: "textarea", name: "body" },
    { type: "boolean", name: "published" },
    { type: "text", name: "title" },
    { type: "number", name: "views", kind: "integer" },
    { type: "text", name: "slug" },
    { type: "text", name: "excerpt" },
    { type: "text", name: "locale" },
  ],
};

describe("listColumns", () => {
  it("puts the labelling field first and keeps the rest in declaration order", () => {
    expect(listColumns(posts).map((field) => field.name)).toEqual([
      "title",
      "published",
      "views",
      "slug",
      "excerpt",
    ]);
  });

  it("leaves textareas out, since a paragraph in a cell crowds out every other column", () => {
    expect(listColumns(posts).some((field) => field.type === "textarea")).toBe(false);
  });

  it("caps how wide a table can get", () => {
    expect(listColumns(posts)).toHaveLength(5);
  });

  it("copes with a collection that has no labelling field", () => {
    const flags: AdminCollection = {
      ...posts,
      labelField: undefined,
      fields: [{ type: "boolean", name: "published" }],
    };

    expect(listColumns(flags).map((field) => field.name)).toEqual(["published"]);
  });
});

describe("isSortable", () => {
  it("refuses a multi-valued column, which the store has no ordering for", () => {
    expect(
      isSortable({ type: "relation", name: "tags", collection: "tags", multiple: true }),
    ).toBe(false);
    expect(isSortable({ type: "text", name: "title" })).toBe(true);
  });
});
