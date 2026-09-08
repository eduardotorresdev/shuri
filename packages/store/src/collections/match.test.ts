import { describe, expect, it } from "vitest";
import { compareValues, matchesFilter, matchesWhere, mergeWhere } from "./match.js";

describe("compareValues", () => {
  it("orders numbers, strings and booleans, and treats anything else as equal", () => {
    expect(compareValues(1, 2)).toBeLessThan(0);
    expect(compareValues("b", "a")).toBeGreaterThan(0);
    expect(compareValues(true, false)).toBeGreaterThan(0);
    expect(compareValues(1, "1")).toBe(0);
    expect(compareValues(null, undefined)).toBe(0);
  });
});

describe("matchesFilter", () => {
  it("implements every op", () => {
    expect(matchesFilter("a", { op: "eq", value: "a" })).toBe(true);
    expect(matchesFilter("a", { op: "ne", value: "a" })).toBe(false);
    expect(matchesFilter(5, { op: "gt", value: 4 })).toBe(true);
    expect(matchesFilter(5, { op: "gte", value: 5 })).toBe(true);
    expect(matchesFilter(5, { op: "lt", value: 5 })).toBe(false);
    expect(matchesFilter(5, { op: "lte", value: 5 })).toBe(true);
    expect(matchesFilter("a", { op: "in", value: ["a", "b"] })).toBe(true);
    expect(matchesFilter("hello", { op: "contains", value: "ell" })).toBe(true);
    expect(matchesFilter(42, { op: "contains", value: "4" })).toBe(false);
  });

  it("keeps eq strict, so a mismatched type never matches", () => {
    expect(matchesFilter(1, { op: "eq", value: "1" })).toBe(false);
  });
});

describe("matchesWhere", () => {
  const record = { id: "1", author: "u1", views: 10 };

  it("requires every field to match", () => {
    expect(
      matchesWhere(record, {
        author: { op: "eq", value: "u1" },
        views: { op: "gt", value: 5 },
      }),
    ).toBe(true);
    expect(
      matchesWhere(record, {
        author: { op: "eq", value: "u1" },
        views: { op: "gt", value: 50 },
      }),
    ).toBe(false);
  });

  it("ANDs every filter of a field's array", () => {
    expect(
      matchesWhere(record, {
        views: [
          { op: "gte", value: 10 },
          { op: "lt", value: 20 },
        ],
      }),
    ).toBe(true);
    expect(
      matchesWhere(record, {
        views: [
          { op: "gte", value: 10 },
          { op: "lt", value: 10 },
        ],
      }),
    ).toBe(false);
  });

  it("matches everything for an empty Where", () => {
    expect(matchesWhere(record, {})).toBe(true);
  });
});

describe("mergeWhere", () => {
  it("keeps every filter of both sides on a shared field", () => {
    expect(
      mergeWhere(
        { author: { op: "eq", value: "u2" }, views: { op: "gt", value: 1 } },
        { author: { op: "eq", value: "u1" } },
      ),
    ).toEqual({
      author: [
        { op: "eq", value: "u2" },
        { op: "eq", value: "u1" },
      ],
      views: { op: "gt", value: 1 },
    });
  });

  it("flattens arrays from either side and tolerates undefined", () => {
    expect(mergeWhere(undefined, { a: [{ op: "eq", value: 1 }] })).toEqual({
      a: { op: "eq", value: 1 },
    });
    expect(mergeWhere(undefined, undefined)).toEqual({});
  });
});
