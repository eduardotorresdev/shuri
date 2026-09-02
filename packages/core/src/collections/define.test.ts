import { describe, expect, it } from "vitest";
import { defineCollections } from "./define.js";
import { CollectionSchemaError } from "./errors.js";
import type { CollectionSchema } from "./types.js";

describe("defineCollections", () => {
  it("returns the collections unchanged when valid", () => {
    const collections: CollectionSchema[] = [
      {
        slug: "posts",
        title: "Posts",
        singular: "Post",
        plural: "Posts",
        fields: [{ type: "text", name: "title", required: true }],
      },
    ];

    expect(defineCollections(collections)).toBe(collections);
  });

  it("throws a CollectionSchemaError listing every issue", () => {
    const collections: CollectionSchema[] = [
      { slug: "", title: "", singular: "", plural: "", fields: [] },
    ];

    expect(() => defineCollections(collections)).toThrow(CollectionSchemaError);

    expect.assertions(3);
    try {
      defineCollections(collections);
    } catch (error) {
      expect(error).toBeInstanceOf(CollectionSchemaError);
      const schemaError = error as CollectionSchemaError;
      expect(schemaError.issues.length).toBeGreaterThan(1);
    }
  });
});
