import { validate } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import type { Field } from "../collections/fields.js";
import { fieldsValidator, fieldValidator } from "./validator.js";

describe("fieldValidator", () => {
  it("accepts a minimal valid field", () => {
    const issues = validate<Field>(
      { type: "text", name: "title" },
      fieldValidator(new Set()),
    );
    expect(issues).toEqual([]);
  });

  it("requires a name", () => {
    const issues = validate<Field>({ type: "text", name: "" }, fieldValidator(new Set()));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: '"name" is required' }),
      ]),
    );
  });

  it("validates a select field's options", () => {
    const issues = validate<Field>(
      { type: "select", name: "status", options: [] },
      fieldValidator(new Set()),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "must declare at least one option",
        }),
      ]),
    );
  });

  it("validates a number field's bounds", () => {
    const issues = validate<Field>(
      { type: "number", name: "rating", kind: "integer", min: 10, max: 1 },
      fieldValidator(new Set()),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: '"min" (10) cannot be greater than "max" (1)',
        }),
      ]),
    );
  });

  it("rejects a relation field referencing an unknown collection", () => {
    const issues = validate<Field>(
      { type: "relation", name: "author", collection: "authors" },
      fieldValidator(new Set()),
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
    const issues = validate<Field>(
      { type: "relation", name: "author", collection: "authors" },
      fieldValidator(new Set(["authors"])),
    );
    expect(issues).toEqual([]);
  });
});

describe("fieldsValidator", () => {
  it("requires at least one field", () => {
    const issues = validate<readonly Field[]>([], fieldsValidator(new Set()));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "must declare at least one field" }),
      ]),
    );
  });

  it("rejects duplicate field names", () => {
    const issues = validate<readonly Field[]>(
      [
        { type: "text", name: "title" },
        { type: "textarea", name: "title" },
      ],
      fieldsValidator(new Set()),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'duplicate field name "title"' }),
      ]),
    );
  });

  it("accepts a well-formed fields array", () => {
    const issues = validate<readonly Field[]>(
      [{ type: "text", name: "title", required: true }],
      fieldsValidator(new Set()),
    );
    expect(issues).toEqual([]);
  });
});
