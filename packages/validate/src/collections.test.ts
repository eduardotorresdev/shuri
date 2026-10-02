import { describe, expect, it } from "vitest";
import { arrayOf, record } from "./collections.js";
import { matches } from "./primitives.js";
import { object, refine, required, validate } from "./validators.js";

describe("arrayOf", () => {
  it("validates each item once confirmed to be an array", () => {
    const items = arrayOf<{ name: string }>(
      object({ name: required('"name" is required') }),
    );
    expect(validate([{ name: "ok" }, { name: "" }], items, "items")).toEqual([
      { path: "items.1.name", message: '"name" is required' },
    ]);
  });

  it("flags a non-array value instead of throwing", () => {
    expect(validate("not an array", arrayOf(required()), "items")).toEqual([
      { path: "items", message: "must be an array" },
    ]);
  });

  describe("options.min", () => {
    const items = arrayOf(required(), undefined, { min: 2 });

    it("flags an array shorter than min at the array's own path", () => {
      expect(validate(["a"], items, "items")).toEqual([
        { path: "items", message: "must have at least 2 items" },
      ]);
      expect(validate([], items, "items")).toHaveLength(1);
    });

    it("accepts an array of exactly min items", () => {
      expect(validate(["a", "b"], items, "items")).toEqual([]);
    });

    it("uses the singular for min 1 and a custom minMessage when given", () => {
      expect(validate([], arrayOf(required(), undefined, { min: 1 }), "i")).toEqual([
        { path: "i", message: "must have at least 1 item" },
      ]);
      const custom = arrayOf(required(), undefined, { min: 1, minMessage: "need ops" });
      expect(validate([], custom, "ops")).toEqual([{ path: "ops", message: "need ops" }]);
    });

    it("still validates the items of a too-short array", () => {
      const issues = validate(
        [""],
        arrayOf(required("empty"), undefined, { min: 2 }),
        "x",
      );
      expect(issues).toEqual([
        { path: "x", message: "must have at least 2 items" },
        { path: "x.0", message: "empty" },
      ]);
    });

    it("reports the type message, not the min message, for a non-array", () => {
      expect(validate("x", items, "items")).toEqual([
        { path: "items", message: "must be an array" },
      ]);
    });
  });
});

describe("record", () => {
  it("validates every value at its own key", () => {
    const filters = record<number>(refine((value) => value > 0, "must be positive"));
    expect(validate({ a: 1, b: -1 }, filters, "where")).toEqual([
      { path: "where.b", message: "must be positive" },
    ]);
  });

  it("flags a non-object value instead of throwing", () => {
    expect(validate([1, 2], record(required()), "where")).toEqual([
      { path: "where", message: "must be an object" },
    ]);
    expect(validate("nope", record(required()), "where")).toEqual([
      { path: "where", message: "must be an object" },
    ]);
  });

  describe("options.key", () => {
    const fields = record(required(), undefined, {
      key: matches(/^[a-z]+$/, "invalid key"),
    });

    it("reports an invalid key at the key's own path", () => {
      expect(validate({ ok: 1, "Bad-Key": 2 }, fields, "fields")).toEqual([
        { path: "fields.Bad-Key", message: "invalid key" },
      ]);
    });

    it("reports both the key and the value issue under the same path", () => {
      expect(
        validate(
          { BAD: "" },
          record(required("empty"), undefined, {
            key: matches(/^[a-z]+$/, "invalid key"),
          }),
          "f",
        ),
      ).toEqual([
        { path: "f.BAD", message: "invalid key" },
        { path: "f.BAD", message: "empty" },
      ]);
    });

    it("accepts valid keys and does not run on a non-object", () => {
      expect(validate({ ok: 1 }, fields, "fields")).toEqual([]);
      expect(validate("x", fields, "fields")).toEqual([
        { path: "fields", message: "must be an object" },
      ]);
    });
  });
});
