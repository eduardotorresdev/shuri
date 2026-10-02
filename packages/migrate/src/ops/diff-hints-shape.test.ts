import { ValidationError } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import { diff, type RenameHints } from "./diff.js";
import { col, create, snap, text } from "./test-support.js";

describe("diff: malformed rename hints", () => {
  const prev = snap(create(col("posts"), { title: text }));
  const issuesOf = (hints: unknown) => {
    try {
      diff(prev, prev, hints as RenameHints);
    } catch (error) {
      if (error instanceof ValidationError) return error.issues;
      throw error;
    }
    throw new Error("expected a ValidationError");
  };

  it("reports an entity hint with a bad kind and a missing name at their own paths", () => {
    expect(issuesOf({ entities: [{ kind: "table", from: "posts" }] })).toEqual([
      { path: "hints.entities.0.kind", message: "must be one of collection, global" },
      { path: "hints.entities.0.to", message: "must be a string" },
    ]);
  });

  it("reports a field hint without a target, with a non-string name and an unknown key", () => {
    expect(
      issuesOf({ fields: [{ target: "posts", from: 1, to: "x", extra: true }] }),
    ).toEqual(
      expect.arrayContaining([
        { path: "hints.fields.0.target", message: "must be an object" },
        { path: "hints.fields.0.from", message: "must be a string" },
        { path: "hints.fields.0.extra", message: 'unknown property "extra"' },
      ]),
    );
  });

  it("reports hints that are not arrays or objects", () => {
    expect(issuesOf({ entities: "posts" })).toEqual([
      { path: "hints.entities", message: "must be an array" },
    ]);
    expect(issuesOf([])).toEqual([{ path: "hints", message: "must be an object" }]);
  });
});
