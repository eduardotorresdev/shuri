import type { FieldShape } from "../schema/snapshot.js";

export interface ConversionCase {
  from: FieldShape;
  to: FieldShape;
  input: unknown;
  /** The expected stored value; `undefined` means the key is removed. */
  output: unknown;
}

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

const row = (from: FieldShape, to: FieldShape, input: unknown, output: unknown) => ({
  from,
  to,
  input,
  output,
});

/**
 * The value-conversion matrix as data. Every driver must reproduce `output` for `input`: memory
 * through `convertValue`, a document store through a guarded pipeline, a SQL driver through CASE/CAST. The
 * cases cover each row of the matrix, including the values a lossy conversion clears, and values
 * already of the target type (which an idempotent re-run meets).
 */
export const CONVERSION_CASES: readonly ConversionCase[] = [
  // text <-> textarea, email -> text/textarea: unchanged
  row(text, textarea, "hello", "hello"),
  row(textarea, text, "line1\nline2", "line1\nline2"),
  row(email, text, "a@b.co", "a@b.co"),
  row(email, textarea, "a@b.co", "a@b.co"),
  // text/textarea -> email: invalid becomes absent
  row(text, email, "a@b.co", "a@b.co"),
  row(textarea, email, "not an email", undefined),
  row(text, email, "two@@ats.com", undefined),
  row(text, email, "a@b.co\n", undefined),
  row(text, email, "a\u00a0b@c.co", undefined),
  row(text, email, "a@b", undefined),
  // number
  row(integer, float, 7, 7),
  row(float, integer, 3.9, 3),
  row(float, integer, -3.9, -3),
  row(float, integer, -0.5, 0),
  row(float, integer, 4, 4),
  row(float, integer, "already text", "already text"),
  // number/boolean -> text/textarea
  row(integer, text, 42, "42"),
  row(float, textarea, 1.5, "1.5"),
  row(bool, text, true, "true"),
  row(bool, textarea, false, "false"),
  row(integer, text, "42", "42"),
  // text/textarea -> number
  row(text, float, "3.14", 3.14),
  row(text, float, "-2", -2),
  row(textarea, integer, "10", 10),
  row(text, integer, "3.5", undefined),
  row(text, integer, "3.0", 3),
  row(text, float, "abc", undefined),
  row(text, float, "1e3", undefined),
  row(text, float, " 12 ", undefined),
  row(text, float, "", undefined),
  row(text, float, "007", 7),
  row(text, integer, "-0", 0),
  row(text, float, "1".repeat(400), undefined),
  row(text, float, 5, 5),
  // text/textarea -> boolean
  row(text, bool, "true", true),
  row(textarea, bool, "false", false),
  row(text, bool, "TRUE", undefined),
  row(text, bool, "yes", undefined),
  row(text, bool, true, true),
  // select <-> text
  row(select, text, "draft", "draft"),
  row(select, textarea, "draft", "draft"),
  row(text, select, "draft", "draft"),
  row(textarea, select, "draft", "draft"),
  row(selectMany, text, ["a", "b"], undefined),
  row(text, selectMany, "a", undefined),
  // single <-> multiple
  row(select, selectMany, "a", ["a"]),
  row(select, selectMany, ["a"], ["a"]),
  row(selectMany, select, ["a", "b"], "a"),
  row(selectMany, select, [], undefined),
  row(selectMany, select, "a", "a"),
  row(selectMany, select, [["x"]], undefined),
  row(rel("tags"), rel("tags", true), "t1", ["t1"]),
  row(rel("tags", true), rel("tags"), ["t1", "t2"], "t1"),
  // relation(A) -> relation(B): ids pass through, with multiplicity applied
  row(rel("tags"), rel("labels"), "t1", "t1"),
  row(rel("tags"), rel("labels", true), "t1", ["t1"]),
  row(rel("tags", true), rel("labels"), ["t1", "t2"], "t1"),
  // everything else clears the value
  row(text, rel("tags"), "t1", undefined),
  row(rel("tags"), text, "t1", undefined),
  row(bool, integer, true, undefined),
  row(integer, bool, 1, undefined),
  row(email, integer, "a@b.co", undefined),
  row(integer, email, 3, undefined),
  row(integer, select, 3, undefined),
  // no value stays no value
  row(text, integer, null, null),
  row(float, integer, undefined, undefined),
  // identical shapes
  row(text, text, "same", "same"),
  row(rel("tags", true), rel("tags", true), ["a"], ["a"]),
];
