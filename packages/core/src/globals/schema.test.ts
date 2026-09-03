import { validate } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import { globalsValidator } from "./schema.js";
import type { GlobalSchema } from "./types.js";

function baseGlobal(overrides: Partial<GlobalSchema> = {}): GlobalSchema {
  return {
    slug: "site",
    title: "Site settings",
    category: { title: "Geral" },
    fields: [{ type: "text", name: "name", required: true }],
    ...overrides,
  };
}

describe("globalsValidator", () => {
  it("accepts a minimal valid global", () => {
    const issues = validate([baseGlobal()], globalsValidator(new Set()));
    expect(issues).toEqual([]);
  });

  it("requires slug and title", () => {
    const issues = validate(
      [baseGlobal({ slug: "", title: "" })],
      globalsValidator(new Set()),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: '"slug" is required' }),
        expect.objectContaining({ message: '"title" is required' }),
      ]),
    );
  });

  it("requires a category title", () => {
    const issues = validate(
      [baseGlobal({ category: { title: "" } })],
      globalsValidator(new Set()),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: '"title" is required' }),
      ]),
    );
  });

  it("rejects duplicate global slugs", () => {
    const issues = validate([baseGlobal(), baseGlobal()], globalsValidator(new Set()));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'duplicate global slug "site"' }),
      ]),
    );
  });

  it("requires at least one field", () => {
    const issues = validate([baseGlobal({ fields: [] })], globalsValidator(new Set()));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "must declare at least one field" }),
      ]),
    );
  });

  it("rejects a relation field referencing an unknown collection", () => {
    const issues = validate(
      [
        baseGlobal({
          fields: [{ type: "relation", name: "author", collection: "authors" }],
        }),
      ],
      globalsValidator(new Set()),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'references unknown collection "authors"',
        }),
      ]),
    );
  });

  it("accepts a relation field referencing a known collection", () => {
    const issues = validate(
      [
        baseGlobal({
          fields: [{ type: "relation", name: "author", collection: "authors" }],
        }),
      ],
      globalsValidator(new Set(["authors"])),
    );
    expect(issues).toEqual([]);
  });
});
