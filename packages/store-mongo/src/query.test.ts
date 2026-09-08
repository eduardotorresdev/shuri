import { describe, expect, it } from "vitest";
import { toMongoFilter, toMongoSort, toMongoWhere } from "./query.js";

describe("toMongoFilter", () => {
  it("maps each comparison op to its Mongo operator", () => {
    expect(toMongoFilter({ op: "eq", value: 1 })).toEqual({ $eq: 1 });
    expect(toMongoFilter({ op: "ne", value: 1 })).toEqual({ $ne: 1 });
    expect(toMongoFilter({ op: "gt", value: 1 })).toEqual({ $gt: 1 });
    expect(toMongoFilter({ op: "gte", value: 1 })).toEqual({ $gte: 1 });
    expect(toMongoFilter({ op: "lt", value: 1 })).toEqual({ $lt: 1 });
    expect(toMongoFilter({ op: "lte", value: 1 })).toEqual({ $lte: 1 });
    expect(toMongoFilter({ op: "in", value: [1, 2] })).toEqual({ $in: [1, 2] });
  });

  it("escapes regex metacharacters in contains so the value is matched literally", () => {
    expect(toMongoFilter({ op: "contains", value: "a.b*(c)" })).toEqual({
      $regex: "a\\.b\\*\\(c\\)",
    });
  });
});

describe("toMongoWhere", () => {
  it("matches everything when there are no filters", () => {
    expect(toMongoWhere(undefined)).toEqual({});
    expect(toMongoWhere({})).toEqual({});
  });

  it("ANDs every filter, including several on the same field", () => {
    expect(
      toMongoWhere({
        name: { op: "eq", value: "x" },
        price: [
          { op: "gt", value: 10 },
          { op: "lt", value: 100 },
        ],
      }),
    ).toEqual({
      $and: [{ name: { $eq: "x" } }, { price: { $gt: 10 } }, { price: { $lt: 100 } }],
    });
  });

  it("maps the id field to _id", () => {
    expect(toMongoWhere({ id: { op: "in", value: ["a", "b"] } })).toEqual({
      $and: [{ _id: { $in: ["a", "b"] } }],
    });
  });
});

describe("toMongoSort", () => {
  it("returns undefined for an unordered query", () => {
    expect(toMongoSort(undefined)).toBeUndefined();
    expect(toMongoSort({ orderBy: [] })).toBeUndefined();
  });

  it("keeps the field order, defaults to asc and maps id to _id", () => {
    expect(
      toMongoSort({
        orderBy: [
          { field: "price", direction: "desc" },
          { field: "name" },
          { field: "id" },
        ],
      }),
    ).toEqual({ price: -1, name: 1, _id: 1 });
  });
});
