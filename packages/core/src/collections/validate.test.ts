import { describe, expect, it } from "vitest";
import { validateCollections } from "./validate.js";
import type { CollectionSchema } from "./types.js";

function baseCollection(overrides: Partial<CollectionSchema> = {}): CollectionSchema {
  return {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [{ type: "text", name: "title", required: true }],
    ...overrides,
  };
}

describe("validateCollections", () => {
  it("accepts a minimal valid collection", () => {
    expect(validateCollections([baseCollection()])).toEqual([]);
  });

  it("accepts internal: true, which is metadata this package only validates", () => {
    expect(validateCollections([baseCollection({ internal: true })])).toEqual([]);
  });

  it("rejects a non-boolean internal", () => {
    const issues = validateCollections([
      baseCollection({ internal: "yes" as unknown as boolean }),
    ]);
    expect(issues).toEqual([expect.stringContaining('"internal" must be a boolean')]);
  });

  it("requires slug, title, singular and plural", () => {
    const issues = validateCollections([
      baseCollection({ slug: "", title: "", singular: "", plural: "" }),
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"slug" is required'),
        expect.stringContaining('"title" is required'),
        expect.stringContaining('"singular" is required'),
        expect.stringContaining('"plural" is required'),
      ]),
    );
  });

  it("rejects duplicate collection slugs", () => {
    const issues = validateCollections([baseCollection(), baseCollection()]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate collection slug "posts"'),
      ]),
    );
  });

  it("requires at least one field", () => {
    const issues = validateCollections([baseCollection({ fields: [] })]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must declare at least one field"),
      ]),
    );
  });

  it("rejects duplicate field names within a collection", () => {
    const issues = validateCollections([
      baseCollection({
        fields: [
          { type: "text", name: "title" },
          { type: "textarea", name: "title" },
        ],
      }),
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([expect.stringContaining('duplicate field name "title"')]),
    );
  });

  describe("select field", () => {
    it("requires at least one option", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [{ type: "select", name: "status", options: [] }],
        }),
      ]);
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining("must declare at least one option"),
        ]),
      );
    });

    it("rejects duplicate option values", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [
            {
              type: "select",
              name: "status",
              options: [
                { label: "Draft", value: "draft" },
                { label: "Duplicate", value: "draft" },
              ],
            },
          ],
        }),
      ]);
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('duplicate option value "draft"'),
        ]),
      );
    });
  });

  describe("number field", () => {
    it("rejects min greater than max", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [
            {
              type: "number",
              name: "rating",
              kind: "integer",
              min: 10,
              max: 1,
            },
          ],
        }),
      ]);
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"min" (10) cannot be greater than "max" (1)'),
        ]),
      );
    });

    it("rejects a negative min when sign is positive", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [
            {
              type: "number",
              name: "rating",
              kind: "integer",
              sign: "positive",
              min: -5,
            },
          ],
        }),
      ]);
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"min" cannot be negative when sign is "positive"'),
        ]),
      );
    });

    it("rejects a positive max when sign is negative", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [
            {
              type: "number",
              name: "rating",
              kind: "integer",
              sign: "negative",
              max: 5,
            },
          ],
        }),
      ]);
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"max" cannot be positive when sign is "negative"'),
        ]),
      );
    });

    it("rejects non-integer bounds when kind is integer", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [{ type: "number", name: "rating", kind: "integer", min: 1.5 }],
        }),
      ]);
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"min" must be an integer when kind is "integer"'),
        ]),
      );
    });

    it("accepts fractional bounds when kind is float", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [
            {
              type: "number",
              name: "price",
              kind: "float",
              min: 0.5,
              max: 9.99,
            },
          ],
        }),
      ]);
      expect(issues).toEqual([]);
    });
  });

  describe("relation field", () => {
    it("rejects a reference to an unknown collection", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [{ type: "relation", name: "author", collection: "authors" }],
        }),
      ]);
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('references unknown collection "authors"'),
        ]),
      );
    });

    it("accepts a reference to a known collection", () => {
      const issues = validateCollections([
        baseCollection({
          fields: [{ type: "relation", name: "author", collection: "authors" }],
        }),
        baseCollection({
          slug: "authors",
          title: "Authors",
          singular: "Author",
          plural: "Authors",
        }),
      ]);
      expect(issues).toEqual([]);
    });
  });
});
