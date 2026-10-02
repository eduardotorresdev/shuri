import {
  CollectionSchemaError,
  GlobalSchemaError,
  type CollectionSchema,
  type GlobalSchema,
} from "@shuri/core";
import { createMemoryAdapter } from "@shuri/store-memory";
import { describe, expect, it } from "vitest";
import { create } from "./create.js";
import { PluginSlugCollisionError } from "./plugin.js";
import { resolveCore, resolveSchema } from "./schema.js";

const posts: CollectionSchema = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  fields: [{ type: "text", name: "title" }],
};
const users: CollectionSchema = {
  slug: "users",
  title: "Users",
  singular: "User",
  plural: "Users",
  fields: [{ type: "email", name: "email", index: true }],
};
const site: GlobalSchema = {
  slug: "site",
  title: "Site",
  category: { title: "Globals" },
  fields: [{ type: "text", name: "name" }],
};

describe("resolveSchema", () => {
  it("returns the declared collections and globals", () => {
    const schema = resolveSchema({ collections: [posts], globals: [site] });
    expect(schema.collections.map((c) => c.slug)).toEqual(["posts"]);
    expect(schema.globals.map((g) => g.slug)).toEqual(["site"]);
  });

  it("has no globals when none are declared", () => {
    expect(resolveSchema({ collections: [posts] }).globals).toEqual([]);
  });

  it("merges every plugin's collections in ahead of the declared ones", () => {
    const schema = resolveSchema({
      collections: [posts],
      plugins: [{ name: "auth", collections: [users] }],
    });
    expect(schema.collections.map((c) => c.slug)).toEqual(["users", "posts"]);
  });

  it("refuses a plugin collection whose slug the app already declares", () => {
    expect(() =>
      resolveSchema({
        collections: [posts, users],
        plugins: [{ name: "auth", collections: [users] }],
      }),
    ).toThrow(PluginSlugCollisionError);
  });

  it("validates the merged schema, a plugin's collections included", () => {
    expect(() =>
      resolveSchema({
        collections: [posts],
        plugins: [{ name: "auth", collections: [{ ...users, slug: "_users" }] }],
      }),
    ).toThrow(CollectionSchemaError);
  });

  it("validates globals", () => {
    expect(() =>
      resolveSchema({
        collections: [posts],
        globals: [{ ...site, slug: "_site" }],
      }),
    ).toThrow(GlobalSchemaError);
  });

  it("fails the same way create() does, so a tool and the app agree on what is valid", () => {
    const bad = {
      collections: [posts],
      plugins: [{ name: "auth", collections: [{ ...users, slug: "_users" }] }],
    };
    expect(() => resolveSchema(bad)).toThrow(CollectionSchemaError);
    expect(() => create({ ...bad, adapter: createMemoryAdapter() })).toThrow(
      CollectionSchemaError,
    );
  });
});

describe("resolveCore", () => {
  it("looks collections up by slug, plugin collections included", () => {
    const core = resolveCore({
      collections: [posts],
      plugins: [{ name: "auth", collections: [users] }],
    });
    expect(core.getCollection("users")).toBe(users);
    expect(core.getCollection("posts")).toBe(posts);
  });
});
