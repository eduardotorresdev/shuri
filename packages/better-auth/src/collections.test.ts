import type { CollectionSchema, Field } from "@shuri/core";
import { defineCollections } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { betterAuthCollections } from "./collections.js";

const bySlug = (
  collections: readonly CollectionSchema[],
  slug: string,
): CollectionSchema =>
  collections.find((collection) => collection.slug === slug) as CollectionSchema;

const field = (collection: CollectionSchema, name: string): Field =>
  collection.fields.find((entry) => entry.name === name) as Field;

describe("betterAuthCollections", () => {
  const collections = betterAuthCollections({ emailAndPassword: { enabled: true } });

  it("declares better-auth's four core tables", () => {
    expect(collections.map((collection) => collection.slug).toSorted()).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
  });

  it("produces a schema @shuri/core accepts, relation targets included", () => {
    expect(() => defineCollections(collections)).not.toThrow();
  });

  it("keeps every table off the HTTP surface", () => {
    expect(collections.every((collection) => collection.internal)).toBe(true);
  });

  it("maps a boolean column to a boolean field", () => {
    expect(field(bySlug(collections, "user"), "emailVerified").type).toBe("boolean");
  });

  it("maps a date column to text, since @shuri/core has no date and better-auth serializes it", () => {
    expect(field(bySlug(collections, "session"), "expiresAt").type).toBe("text");
  });

  it("maps a foreign key to a relation pointing at the referenced table", () => {
    const userId = field(bySlug(collections, "session"), "userId");

    expect(userId).toMatchObject({ type: "relation", collection: "user" });
  });

  it("carries better-auth's own required flags", () => {
    expect(field(bySlug(collections, "user"), "email").required).toBe(true);
    expect(field(bySlug(collections, "user"), "image").required).toBeUndefined();
  });

  it("hides every secret-bearing column, so none can leak if a table is ever served", () => {
    expect(field(bySlug(collections, "session"), "token").hidden).toBe(true);
    expect(field(bySlug(collections, "account"), "password").hidden).toBe(true);
    expect(field(bySlug(collections, "account"), "accessToken").hidden).toBe(true);
    expect(field(bySlug(collections, "verification"), "value").hidden).toBe(true);
  });

  it("leaves an ordinary column visible", () => {
    expect(field(bySlug(collections, "user"), "email").hidden).toBeUndefined();
  });

  it("grows with better-auth's own schema rather than needing an edit here", () => {
    // `user.image` only exists because better-auth declares it; nothing in this package names it.
    expect(field(bySlug(collections, "user"), "image")).toBeDefined();
  });
});
