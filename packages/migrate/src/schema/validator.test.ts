import { validate } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import { fieldsOf, glob } from "../ops/test-support.js";
import type { SchemaSnapshot } from "./snapshot.js";
import {
  fieldShapeValidator,
  fieldSpecValidator,
  validateSnapshot,
} from "./validator.js";

const messages = (value: unknown, validator = fieldSpecValidator) =>
  validate(value, validator).map((issue) => `${issue.path}: ${issue.message}`);

describe("fieldSpecValidator", () => {
  it.each([
    { type: "text", index: false },
    { type: "textarea", index: true },
    { type: "email", index: false },
    { type: "boolean", index: false },
    { type: "number", kind: "float", index: false },
    { type: "select", multiple: true, index: false },
    { type: "relation", collection: "tags", multiple: false, index: true },
  ])("accepts %j", (spec) => expect(messages(spec)).toEqual([]));

  it("reports an unknown type at the tag", () => {
    expect(messages({ type: "color", index: false })).toEqual([
      "type: must be one of text, textarea, email, boolean, number, select, relation",
    ]);
  });

  it("reports a non-object", () => {
    expect(messages("text")).toEqual([": must be an object"]);
  });

  it("requires index, kind, multiple and a valid relation target", () => {
    expect(messages({ type: "text" })).toEqual(['index: "index" must be a boolean']);
    expect(messages({ type: "number", index: false })).toEqual([
      "kind: must be one of integer, float",
    ]);
    expect(messages({ type: "select", index: false })).toEqual([
      'multiple: "multiple" must be a boolean',
    ]);
    expect(
      messages({ type: "relation", collection: "_x", multiple: false, index: false }),
    ).toEqual([expect.stringContaining("collection: must match")]);
  });

  it("rejects properties the snapshot does not track", () => {
    expect(messages({ type: "text", index: false, required: true })).toEqual([
      'required: unknown property "required"',
    ]);
  });
});

describe("fieldShapeValidator", () => {
  it("accepts a shape and rejects an index inside it", () => {
    expect(
      messages(
        { type: "relation", collection: "a", multiple: false },
        fieldShapeValidator,
      ),
    ).toEqual([]);
    expect(messages({ type: "text", index: false }, fieldShapeValidator)).toEqual([
      'index: unknown property "index"',
    ]);
  });
});

describe("validateSnapshot", () => {
  const sound: SchemaSnapshot = {
    version: 1,
    collections: {
      posts: {
        fields: {
          author: {
            type: "relation",
            collection: "authors",
            multiple: false,
            index: false,
          },
        },
      },
      authors: { fields: { name: { type: "text", index: true } } },
    },
    globals: { site: { fields: { tagline: { type: "text", index: false } } } },
  };

  it("accepts a sound snapshot", () => {
    expect(validateSnapshot(sound)).toEqual([]);
  });

  it("checks versions, slugs and field names", () => {
    const issues = validateSnapshot({
      version: 2,
      collections: { _hidden: { fields: { id: { type: "text", index: false } } } },
      globals: {},
    }).map((issue) => `${issue.path}: ${issue.message}`);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("version:"),
        expect.stringContaining("collections._hidden:"),
        expect.stringContaining('"id" is reserved'),
      ]),
    );
  });

  it("rejects an unknown top-level property", () => {
    expect(validateSnapshot({ ...sound, extra: 1 })).toEqual([
      { path: "extra", message: 'unknown property "extra"' },
    ]);
  });

  it("rejects an indexed global field (a global has no index)", () => {
    const bad = structuredClone(sound);
    fieldsOf({ snapshot: bad }, glob("site")).tagline = { type: "text", index: true };
    expect(validateSnapshot(bad)).toEqual([
      {
        path: "global:site.tagline",
        message: expect.stringContaining("global has no index"),
      },
    ]);
  });

  it("rejects a relation to a missing collection", () => {
    const bad = structuredClone(sound);
    delete bad.collections.authors;
    expect(validateSnapshot(bad)).toEqual([
      {
        path: "collection:posts.author",
        message: expect.stringContaining('unknown collection "authors"'),
      },
    ]);
  });
});
