import { createCore, type CollectionSchema, type GlobalSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SNAPSHOT,
  fieldSpecOf,
  shapeOf,
  snapshotOf,
  snapshotsEqual,
  withIndex,
  type SchemaSnapshot,
} from "./snapshot.js";
import { col, fieldsOf } from "../ops/test-support.js";

const posts: CollectionSchema = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  orderable: true,
  internal: true,
  access: { list: true },
  fields: [
    {
      type: "text",
      name: "title",
      label: "Title",
      required: true,
      minLength: 1,
      maxLength: 9,
    },
    { type: "textarea", name: "body", hidden: true },
    { type: "email", name: "contact", index: true },
    { type: "boolean", name: "featured" },
    { type: "number", name: "views", kind: "integer", sign: "positive", min: 0, max: 10 },
    {
      type: "select",
      name: "status",
      options: [{ label: "Draft", value: "draft" }],
      multiple: true,
    },
    { type: "relation", name: "author", collection: "authors", index: true },
    { type: "relation", name: "tags", collection: "authors", multiple: true },
  ],
};
const authors: CollectionSchema = {
  slug: "authors",
  title: "Authors",
  singular: "Author",
  plural: "Authors",
  fields: [{ type: "text", name: "name" }],
};
const site: GlobalSchema = {
  slug: "site",
  title: "Site",
  category: { title: "General" },
  fields: [{ type: "text", name: "tagline", label: "Tagline" }],
};

describe("fieldSpecOf", () => {
  it("applies the defaults: multiple false, index false", () => {
    expect(fieldSpecOf({ type: "text", name: "a" })).toEqual({
      type: "text",
      index: false,
    });
    expect(fieldSpecOf({ type: "select", name: "a", options: [] })).toEqual({
      type: "select",
      multiple: false,
      index: false,
    });
    expect(fieldSpecOf({ type: "relation", name: "a", collection: "x" })).toEqual({
      type: "relation",
      collection: "x",
      multiple: false,
      index: false,
    });
  });

  it("keeps kind for numbers and the type-specific traits, and ignores every constraint", () => {
    expect(
      fieldSpecOf({
        type: "number",
        name: "n",
        kind: "float",
        sign: "negative",
        min: -9,
        max: -1,
      }),
    ).toEqual({ type: "number", kind: "float", index: false });
    expect(
      fieldSpecOf({
        type: "select",
        name: "s",
        options: [{ label: "A", value: "a" }],
        multiple: true,
        index: true,
        required: true,
      }),
    ).toEqual({ type: "select", multiple: true, index: true });
  });
});

describe("shapeOf / withIndex", () => {
  it("drops the index and withIndex puts it back", () => {
    const spec = fieldSpecOf({
      type: "relation",
      name: "r",
      collection: "x",
      index: true,
    });
    const shape = shapeOf(spec);
    expect(shape).toEqual({ type: "relation", collection: "x", multiple: false });
    expect("index" in shape).toBe(false);
    expect(withIndex(shape, true)).toEqual(spec);
  });

  it("does not mutate the spec", () => {
    const spec = fieldSpecOf({ type: "text", name: "t", index: true });
    shapeOf(spec);
    expect(spec).toEqual({ type: "text", index: true });
  });
});

describe("snapshotOf", () => {
  const core = createCore({ collections: [posts, authors], globals: [site] });
  const snapshot = snapshotOf(core);

  it("projects collections and globals onto field specs", () => {
    expect(snapshot).toEqual({
      version: 1,
      collections: {
        posts: {
          fields: {
            title: { type: "text", index: false },
            body: { type: "textarea", index: false },
            contact: { type: "email", index: true },
            featured: { type: "boolean", index: false },
            views: { type: "number", kind: "integer", index: false },
            status: { type: "select", multiple: true, index: false },
            author: {
              type: "relation",
              collection: "authors",
              multiple: false,
              index: true,
            },
            tags: {
              type: "relation",
              collection: "authors",
              multiple: true,
              index: false,
            },
          },
        },
        authors: { fields: { name: { type: "text", index: false } } },
      },
      globals: { site: { fields: { tagline: { type: "text", index: false } } } },
    });
  });

  it("ignores everything the snapshot does not track", () => {
    const stripped: CollectionSchema = {
      slug: "posts",
      title: "Different",
      singular: "X",
      plural: "Y",
      fields: posts.fields.map((field) => {
        const { label, hidden, required, ...rest } = field as typeof field & {
          label?: string;
          hidden?: boolean;
          required?: boolean;
        };
        void [label, hidden, required];
        return rest as typeof field;
      }),
    };
    const other = snapshotOf({ collections: [stripped, authors], globals: [site] });
    expect(other.collections.posts).toEqual(snapshot.collections.posts);
  });

  it("is independent of the order collections are declared in", () => {
    const reordered = snapshotOf({ collections: [authors, posts], globals: [site] });
    expect(snapshotsEqual(reordered, snapshot)).toBe(true);
  });

  it("snapshots an empty schema as EMPTY_SNAPSHOT", () => {
    expect(
      snapshotsEqual(snapshotOf({ collections: [], globals: [] }), EMPTY_SNAPSHOT),
    ).toBe(true);
  });
});

describe("snapshotsEqual", () => {
  const base: SchemaSnapshot = {
    version: 1,
    collections: { a: { fields: { x: { type: "text", index: false } } } },
    globals: {},
  };

  it("ignores key order", () => {
    const shuffled: SchemaSnapshot = {
      globals: {},
      collections: { a: { fields: { x: { index: false, type: "text" } } } },
      version: 1,
    };
    expect(snapshotsEqual(base, shuffled)).toBe(true);
  });

  it("detects a changed index, type and a missing field", () => {
    const indexed = structuredClone(base);
    fieldsOf({ snapshot: indexed }, col("a")).x = { type: "text", index: true };
    const retyped = structuredClone(base);
    fieldsOf({ snapshot: retyped }, col("a")).x = { type: "textarea", index: false };
    const emptied: SchemaSnapshot = { ...base, collections: { a: { fields: {} } } };
    expect(snapshotsEqual(base, indexed)).toBe(false);
    expect(snapshotsEqual(base, retyped)).toBe(false);
    expect(snapshotsEqual(base, emptied)).toBe(false);
  });
});
