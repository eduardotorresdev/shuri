import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { buildAdminSchema, labelFieldOf } from "./build.js";

const posts: CollectionSchema = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  fields: [
    { type: "textarea", name: "body" },
    { type: "text", name: "title", required: true },
    { type: "text", name: "draftNotes", hidden: true },
  ],
};

const sessions: CollectionSchema = {
  slug: "_sessions",
  title: "Sessions",
  singular: "Session",
  plural: "Sessions",
  internal: true,
  fields: [{ type: "text", name: "tokenHash" }],
};

const site: GlobalSchema = {
  slug: "site",
  title: "Site",
  category: { title: "Geral" },
  fields: [
    { type: "text", name: "name" },
    { type: "text", name: "deployKey", hidden: true },
  ],
};

describe("labelFieldOf", () => {
  it("picks the first text or email field, skipping textareas", () => {
    expect(labelFieldOf(posts.fields)).toBe("title");
  });

  it("has no answer for a collection with nothing name-shaped", () => {
    expect(labelFieldOf([{ type: "boolean", name: "published" }])).toBeUndefined();
  });
});

describe("buildAdminSchema", () => {
  it("describes every servable collection without its hidden fields", () => {
    const schema = buildAdminSchema({ collections: [posts, sessions] });

    expect(schema.collections).toHaveLength(1);
    expect(schema.collections[0]?.slug).toBe("posts");
    expect(schema.collections[0]?.fields.map((field) => field.name)).toEqual([
      "body",
      "title",
    ]);
    expect(schema.collections[0]?.labelField).toBe("title");
  });

  it("leaves an internal collection out entirely, as the OpenAPI document does", () => {
    const schema = buildAdminSchema({ collections: [posts, sessions] });

    expect(schema.collections.some((entry) => entry.slug === "_sessions")).toBe(false);
  });

  it("flattens a global's category and drops its hidden fields", () => {
    const schema = buildAdminSchema({ collections: [], globals: [site] });

    expect(schema.globals).toEqual([
      {
        slug: "site",
        title: "Site",
        category: "Geral",
        fields: [{ type: "text", name: "name" }],
      },
    ]);
  });

  it("advertises the default paths, and the overridden ones when given", () => {
    expect(buildAdminSchema({ collections: [] }).api).toEqual({
      collections: "/collections",
      globals: "/globals",
      events: "/events",
    });

    const moved = buildAdminSchema(
      { collections: [] },
      { basePath: "/cms", api: { collections: "/api/collections" } },
    );
    expect(moved.basePath).toBe("/cms");
    expect(moved.api.collections).toBe("/api/collections");
    expect(moved.api.globals).toBe("/globals");
  });
});
