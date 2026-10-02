import { describe, expect, it } from "vitest";
import type { FieldShape } from "../schema/snapshot.js";
import { conversionOf, isDestructive, type Conversion } from "./conversion.js";
import { col } from "./test-support.js";
import type { MigrationOp } from "./types.js";

const text: FieldShape = { type: "text" };
const textarea: FieldShape = { type: "textarea" };
const email: FieldShape = { type: "email" };
const bool: FieldShape = { type: "boolean" };
const integer: FieldShape = { type: "number", kind: "integer" };
const float: FieldShape = { type: "number", kind: "float" };
const select: FieldShape = { type: "select", multiple: false };
const selectMany: FieldShape = { type: "select", multiple: true };
const rel = (collection: string, multiple = false): FieldShape => ({
  type: "relation",
  collection,
  multiple,
});

const table: [string, FieldShape, FieldShape, Conversion][] = [
  ["same shape", text, text, "identical"],
  ["text -> textarea", text, textarea, "lossless"],
  ["textarea -> text", textarea, text, "lossless"],
  ["email -> text", email, text, "lossless"],
  ["email -> textarea", email, textarea, "lossless"],
  ["text -> email", text, email, "lossy"],
  ["textarea -> email", textarea, email, "lossy"],
  ["integer -> float", integer, float, "lossless"],
  ["float -> integer", float, integer, "lossy"],
  ["number -> text", integer, text, "lossless"],
  ["number -> textarea", float, textarea, "lossless"],
  ["boolean -> text", bool, text, "lossless"],
  ["boolean -> textarea", bool, textarea, "lossless"],
  ["text -> number", text, integer, "lossy"],
  ["textarea -> number", textarea, float, "lossy"],
  ["text -> boolean", text, bool, "lossy"],
  ["single select -> text", select, text, "lossless"],
  ["single select -> textarea", select, textarea, "lossless"],
  ["multiple select -> text", selectMany, text, "lossy"],
  ["text -> select", text, select, "lossy"],
  ["textarea -> select", textarea, select, "lossy"],
  ["select single -> multiple", select, selectMany, "lossless"],
  ["select multiple -> single", selectMany, select, "lossy"],
  ["relation single -> multiple", rel("a"), rel("a", true), "lossless"],
  ["relation multiple -> single", rel("a", true), rel("a"), "lossy"],
  ["relation A -> relation B", rel("a"), rel("b"), "lossy"],
  ["relation A -> relation B, also to multiple", rel("a"), rel("b", true), "lossy"],
  ["relation -> text", rel("a"), text, "lossy"],
  ["text -> relation", text, rel("a"), "lossy"],
  ["boolean -> number", bool, integer, "lossy"],
  ["number -> boolean", integer, bool, "lossy"],
  ["number -> email", integer, email, "lossy"],
  ["email -> number", email, integer, "lossy"],
  ["number -> select", integer, select, "lossy"],
  ["select -> relation", select, rel("a"), "lossy"],
];

describe("conversionOf", () => {
  it.each(table)("%s is %s", (_label, from, to, expected) => {
    expect(conversionOf(from, to)).toBe(expected);
  });

  it("treats key order as irrelevant for identity", () => {
    expect(
      conversionOf(
        { type: "relation", collection: "a", multiple: false },
        { multiple: false, collection: "a", type: "relation" },
      ),
    ).toBe("identical");
  });
});

const alter = (from: FieldShape, to: FieldShape): MigrationOp => ({
  op: "alterField",
  target: col("c"),
  name: "f",
  from,
  to,
});

describe("isDestructive", () => {
  it("is true for drops and for a lossy alterField", () => {
    expect(isDestructive({ op: "dropEntity", target: col("c") })).toBe(true);
    expect(isDestructive({ op: "dropField", target: col("c"), name: "f" })).toBe(true);
    expect(isDestructive(alter(float, integer))).toBe(true);
    expect(isDestructive(alter(text, email))).toBe(true);
  });

  it("is false for a lossless alterField and for everything constructive", () => {
    expect(isDestructive(alter(text, textarea))).toBe(false);
    expect(isDestructive(alter(integer, float))).toBe(false);
    expect(isDestructive({ op: "createEntity", target: col("c"), fields: {} })).toBe(
      false,
    );
    expect(isDestructive({ op: "renameEntity", target: col("c"), to: "d" })).toBe(false);
    expect(
      isDestructive({
        op: "addField",
        target: col("c"),
        name: "f",
        spec: { type: "text", index: false },
      }),
    ).toBe(false);
    expect(
      isDestructive({ op: "renameField", target: col("c"), from: "a", to: "b" }),
    ).toBe(false);
    expect(
      isDestructive({ op: "setIndex", target: col("c"), name: "f", index: true }),
    ).toBe(false);
  });
});
