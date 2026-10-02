import { validate } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import { migrationOpValidator } from "./validator.js";
import { OP_NAMES, type MigrationOp } from "./types.js";
import {
  add,
  col,
  create,
  dropEntity,
  dropField,
  glob,
  int,
  rel,
  renameEntity,
  renameField,
  text,
} from "./test-support.js";

const issuesOf = (op: unknown) =>
  validate(op, migrationOpValidator).map((issue) => `${issue.path}: ${issue.message}`);

describe("migrationOpValidator", () => {
  const valid: MigrationOp[] = [
    create(col("posts"), { title: text, author: rel("authors") }),
    dropEntity(glob("site")),
    renameEntity(col("tags"), "labels"),
    add(col("posts"), "views", int),
    dropField(col("posts"), "views"),
    renameField(col("posts"), "a", "b"),
    {
      op: "alterField",
      target: col("posts"),
      name: "views",
      from: { type: "number", kind: "integer" },
      to: { type: "number", kind: "float" },
    },
    { op: "setIndex", target: col("posts"), name: "views", index: true },
  ];

  it("accepts one valid op of every kind (and the list covers every OpName)", () => {
    expect(new Set(valid.map((op) => op.op))).toEqual(new Set(OP_NAMES));
    for (const op of valid) expect(issuesOf(op)).toEqual([]);
  });

  it("reports an unknown or missing op at the tag", () => {
    expect(issuesOf({ op: "truncate", target: col("a") })).toEqual([
      'op: unknown op "truncate"; must be one of ' + OP_NAMES.join(", "),
    ]);
    expect(issuesOf({ target: col("a") })).toEqual([
      expect.stringMatching(/^op: unknown op/),
    ]);
    expect(issuesOf("dropEntity")).toEqual([": must be an object"]);
  });

  it("validates the target: kind and slug grammar", () => {
    expect(issuesOf({ op: "dropEntity", target: { kind: "view", slug: "a" } })).toEqual([
      "target.kind: must be one of collection, global",
    ]);
    expect(
      issuesOf({ op: "dropEntity", target: { kind: "collection", slug: "_a" } }),
    ).toEqual([expect.stringContaining("target.slug: must match")]);
    expect(issuesOf({ op: "dropEntity" })).toEqual(["target: must be an object"]);
  });

  it("applies the field-name grammar and rejects the reserved id", () => {
    expect(issuesOf({ ...dropField(col("a"), "id") })).toEqual([
      'name: "id" is reserved',
    ]);
    expect(issuesOf({ ...dropField(col("a"), "1x") })).toEqual([
      expect.stringContaining("name: must match"),
    ]);
    expect(issuesOf(create(col("a"), { "bad-name": text }))).toEqual([
      expect.stringContaining("fields.bad-name: must match"),
    ]);
  });

  it("reports nested spec errors with their full path", () => {
    expect(
      issuesOf({ op: "addField", target: col("a"), name: "x", spec: { type: "text" } }),
    ).toEqual(['spec.index: "index" must be a boolean']);
    expect(
      issuesOf({
        op: "createEntity",
        target: col("a"),
        fields: { x: { type: "number", index: false } },
      }),
    ).toEqual(["fields.x.kind: must be one of integer, float"]);
  });

  it("rejects an index inside an alterField shape", () => {
    expect(
      issuesOf({
        op: "alterField",
        target: col("a"),
        name: "x",
        from: { type: "text", index: false },
        to: { type: "textarea" },
      }),
    ).toEqual(['from.index: unknown property "index"']);
  });

  it("rejects unknown properties on an op", () => {
    expect(issuesOf({ ...dropEntity(col("a")), cascade: true })).toEqual([
      'cascade: unknown property "cascade"',
    ]);
  });

  it("rejects no-op renames and no-op alters", () => {
    expect(issuesOf(renameEntity(col("a"), "a"))).toEqual([
      "to: must differ from the current slug",
    ]);
    expect(issuesOf(renameField(col("a"), "x", "x"))).toEqual([
      "to: must differ from `from`",
    ]);
    expect(
      issuesOf({
        op: "alterField",
        target: col("a"),
        name: "x",
        from: { type: "text" },
        to: { type: "text" },
      }),
    ).toEqual(["to: must differ from `from`"]);
  });

  it("requires a boolean index on setIndex", () => {
    expect(
      issuesOf({ op: "setIndex", target: col("a"), name: "x", index: "yes" }),
    ).toEqual(['index: "index" must be a boolean']);
  });
});
