import { validate } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import type { Field } from "../collections/fields.js";
import { validateCollections } from "../collections/validate.js";
import { globalsValidator } from "../globals/schema.js";
import { fieldValidator } from "./validator.js";

const field: Field = { type: "text", name: "title" };

describe("reserved slug prefix", () => {
  it("rejects a collection slug starting with an underscore", () => {
    const issues = validateCollections([
      { slug: "_sessions", title: "S", singular: "S", plural: "S", fields: [field] },
    ]);
    expect(issues).toEqual([
      expect.stringContaining('slug "_sessions" cannot start with "_"'),
    ]);
  });

  it("accepts an underscore anywhere but the start", () => {
    expect(
      validateCollections([
        { slug: "blog_posts", title: "P", singular: "P", plural: "P", fields: [field] },
      ]),
    ).toEqual([]);
  });

  it("rejects a global slug starting with an underscore", () => {
    const issues = validate(
      [{ slug: "_site", title: "Site", category: { title: "G" }, fields: [field] }],
      globalsValidator(new Set()),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        path: "_site.slug",
        message: expect.stringContaining("reserved"),
      }),
    ]);
  });
});

describe("reserved field name", () => {
  it("rejects a field named id", () => {
    const issues = validate<Field>(
      { type: "text", name: "id" },
      fieldValidator(new Set()),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        path: "name",
        message: expect.stringContaining("reserved"),
      }),
    ]);
  });

  it("rejects an id field in a collection", () => {
    const issues = validateCollections([
      {
        slug: "posts",
        title: "P",
        singular: "P",
        plural: "P",
        fields: [{ type: "text", name: "id" }],
      },
    ]);
    expect(issues).toEqual([expect.stringContaining("reserved")]);
  });

  it("accepts names that merely contain id", () => {
    const issues = validate<Field>(
      { type: "text", name: "userId" },
      fieldValidator(new Set()),
    );
    expect(issues).toEqual([]);
  });
});
