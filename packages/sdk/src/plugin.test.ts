import type { CollectionSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import {
  collectPluginAccess,
  collectPluginCollections,
  collectPluginOpenApi,
  PluginPrincipalConflictError,
  PluginSlugCollisionError,
} from "./plugin.js";

const collection = (slug: string): CollectionSchema => ({
  slug,
  title: slug,
  singular: slug,
  plural: slug,
  fields: [],
});

describe("collectPluginCollections", () => {
  it("gathers every plugin's collections, in plugin order", () => {
    const gathered = collectPluginCollections(
      [
        { name: "a", collections: [collection("one")] },
        { name: "b", collections: [collection("two"), collection("three")] },
      ],
      new Set(),
    );

    expect(gathered.map((entry) => entry.slug)).toEqual(["one", "two", "three"]);
  });

  it("has nothing to gather from a plugin that only contributes handlers", () => {
    expect(
      collectPluginCollections([{ name: "a", handlers: () => [] }], new Set()),
    ).toEqual([]);
  });

  it("names the plugin when its slug is already the app's", () => {
    const collide = () =>
      collectPluginCollections(
        [{ name: "@shuri/better-auth", collections: [collection("user")] }],
        new Set(["user"]),
      );

    expect(collide).toThrow(PluginSlugCollisionError);
    expect(collide).toThrow(/@shuri\/better-auth/);
    expect(collide).toThrow(/"user"/);
  });

  it("catches two plugins claiming the same slug as well", () => {
    expect(() =>
      collectPluginCollections(
        [
          { name: "a", collections: [collection("user")] },
          { name: "b", collections: [collection("user")] },
        ],
        new Set(),
      ),
    ).toThrow(/Plugin "b"/);
  });
});

const principal = async () => ({ kind: "anonymous" as const });

describe("collectPluginAccess", () => {
  it("is nothing when no plugin authenticates, so every route stays open", () => {
    expect(collectPluginAccess([{ name: "a" }])).toBeUndefined();
  });

  it("is the one plugin's resolver", () => {
    expect(collectPluginAccess([{ name: "a" }, { name: "auth", principal }])).toEqual({
      principal,
    });
  });

  it("refuses two resolvers, naming both plugins", () => {
    const collide = () =>
      collectPluginAccess([
        { name: "first", principal },
        { name: "second", principal },
      ]);

    expect(collide).toThrow(PluginPrincipalConflictError);
    expect(collide).toThrow(/"first" and "second"/);
  });
});

describe("collectPluginOpenApi", () => {
  it("unions the path items and keeps the authenticating plugin's security", () => {
    const security = { schemes: {}, requirements: () => [] };

    expect(
      collectPluginOpenApi([
        { name: "a", openapi: { paths: { "/a": {} } } },
        { name: "b", openapi: { paths: { "/b": {} }, security } },
      ]),
    ).toEqual({ paths: { "/a": {}, "/b": {} }, security });
  });

  it("is empty when no plugin contributes", () => {
    expect(collectPluginOpenApi([{ name: "a" }])).toEqual({});
  });
});
