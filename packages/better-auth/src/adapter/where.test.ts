import type { CleanedWhere } from "better-auth/adapters";
import { describe, expect, it } from "vitest";
import { isPushable, toStoreQuery, toStoreWhere } from "./where.js";

const clause = (partial: Partial<CleanedWhere>): CleanedWhere =>
  ({
    field: "id",
    value: "1",
    operator: "eq",
    connector: "AND",
    mode: "sensitive",
    ...partial,
  }) as CleanedWhere;

describe("isPushable", () => {
  it("accepts the AND-of-one-operator-per-field shape the store's Query can express", () => {
    expect(
      isPushable([
        clause({ field: "email" }),
        clause({ field: "userId", operator: "ne" }),
      ]),
    ).toBe(true);
  });

  it("accepts every operator the store has a name for", () => {
    for (const operator of [
      "eq",
      "ne",
      "lt",
      "lte",
      "gt",
      "gte",
      "in",
      "contains",
    ] as const) {
      expect(
        isPushable([clause({ operator, value: operator === "in" ? ["a"] : "a" })]),
      ).toBe(true);
    }
  });

  it("refuses an OR, which the store's flat filter cannot express", () => {
    expect(isPushable([clause({}), clause({ field: "email", connector: "OR" })])).toBe(
      false,
    );
  });

  it("refuses two clauses on one field, since the filter holds one operator per field", () => {
    expect(
      isPushable([
        clause({ field: "createdAt", operator: "gte" }),
        clause({ field: "createdAt", operator: "lte" }),
      ]),
    ).toBe(false);
  });

  it("refuses the operators the store has no equivalent for", () => {
    for (const operator of ["not_in", "starts_with", "ends_with"] as const) {
      expect(isPushable([clause({ operator })])).toBe(false);
    }
  });

  it("refuses case-insensitive matching, which the store compares exactly", () => {
    expect(isPushable([clause({ mode: "insensitive" })])).toBe(false);
  });

  it("accepts an empty clause list", () => {
    expect(isPushable([])).toBe(true);
  });
});

describe("toStoreWhere", () => {
  it("maps each clause onto the store's own operator", () => {
    expect(
      toStoreWhere([
        clause({ field: "email", value: "a@b.com" }),
        clause({ field: "count", operator: "gte", value: 3 }),
      ]),
    ).toEqual({
      email: { op: "eq", value: "a@b.com" },
      count: { op: "gte", value: 3 },
    });
  });

  it("keeps an `in` value as an array", () => {
    expect(toStoreWhere([clause({ operator: "in", value: ["a", "b"] })])).toEqual({
      id: { op: "in", value: ["a", "b"] },
    });
  });

  it("wraps a lone `in` value, which the store's filter requires as a list", () => {
    expect(toStoreWhere([clause({ operator: "in", value: "a" })])).toEqual({
      id: { op: "in", value: ["a"] },
    });
  });
});

describe("toStoreQuery", () => {
  it("pushes the filter and the page down together", () => {
    expect(toStoreQuery([clause({ field: "email" })], { limit: 5, offset: 10 })).toEqual({
      query: { where: { email: { op: "eq", value: "1" } }, limit: 5, offset: 10 },
      filtered: true,
    });
  });

  it("pushes nothing at all for a query the store cannot express", () => {
    expect(toStoreQuery([clause({ operator: "starts_with" })], { limit: 5 })).toEqual({
      query: {},
      filtered: false,
    });
  });

  it("holds the page back with the filter, so the slice is cut from the right set", () => {
    const { query } = toStoreQuery(
      [clause({ connector: "OR" }), clause({ connector: "OR" })],
      {
        limit: 5,
        offset: 2,
      },
    );

    expect(query.limit).toBeUndefined();
    expect(query.offset).toBeUndefined();
  });

  it("leaves `where` off entirely for an empty clause list", () => {
    expect(toStoreQuery([], { limit: 1 })).toEqual({
      query: { limit: 1 },
      filtered: true,
    });
  });
});
