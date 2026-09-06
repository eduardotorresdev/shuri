import type { CleanedWhere } from "better-auth/adapters";
import { describe, expect, it } from "vitest";
import { matchesWhere } from "./match.js";

const clause = (partial: Partial<CleanedWhere>): CleanedWhere =>
  ({
    field: "email",
    value: "Ada@Example.com",
    operator: "eq",
    connector: "AND",
    mode: "sensitive",
    ...partial,
  }) as CleanedWhere;

const record = { id: "1", email: "ada@example.com", count: 5, name: null };

describe("matchesWhere", () => {
  it("matches everything for an empty clause list", () => {
    expect(matchesWhere(record, [])).toBe(true);
  });

  it("compares exactly by default", () => {
    expect(matchesWhere(record, [clause({ value: "ada@example.com" })])).toBe(true);
    expect(matchesWhere(record, [clause({})])).toBe(false);
  });

  it("ignores case when the clause asks it to", () => {
    expect(matchesWhere(record, [clause({ mode: "insensitive" })])).toBe(true);
  });

  it("handles the operators the store cannot push down", () => {
    expect(
      matchesWhere(record, [clause({ operator: "starts_with", value: "ada" })]),
    ).toBe(true);
    expect(matchesWhere(record, [clause({ operator: "ends_with", value: ".com" })])).toBe(
      true,
    );
    expect(matchesWhere(record, [clause({ operator: "not_in", value: ["x@y.z"] })])).toBe(
      true,
    );
    expect(
      matchesWhere(record, [clause({ operator: "not_in", value: ["ada@example.com"] })]),
    ).toBe(false);
  });

  it("orders numbers", () => {
    expect(
      matchesWhere(record, [clause({ field: "count", operator: "gt", value: 4 })]),
    ).toBe(true);
    expect(
      matchesWhere(record, [clause({ field: "count", operator: "lt", value: 4 })]),
    ).toBe(false);
  });

  it("never orders against null, which would compare as zero", () => {
    expect(
      matchesWhere(record, [clause({ field: "count", operator: "gt", value: null })]),
    ).toBe(false);
    expect(
      matchesWhere(record, [clause({ field: "name", operator: "gte", value: 0 })]),
    ).toBe(false);
  });

  it("treats an absent field and a stored null as the same absence", () => {
    expect(matchesWhere(record, [clause({ field: "name", value: null })])).toBe(true);
    expect(matchesWhere(record, [clause({ field: "missing", value: null })])).toBe(true);
  });

  it("refuses a string operator against a non-string, rather than coercing", () => {
    expect(
      matchesWhere(record, [
        clause({ field: "count", operator: "contains", value: "5" }),
      ]),
    ).toBe(false);
  });

  it("ANDs a clause list", () => {
    const where = [
      clause({ value: "ada@example.com" }),
      clause({ field: "count", operator: "gte", value: 5 }),
    ];

    expect(matchesWhere(record, where)).toBe(true);
    expect(matchesWhere({ ...record, count: 1 }, where)).toBe(false);
  });

  it("ORs a clause marked OR, matching better-auth's own fold", () => {
    const where = [
      clause({ value: "nobody@example.com" }),
      clause({ field: "count", operator: "eq", value: 5, connector: "OR" }),
    ];

    expect(matchesWhere(record, where)).toBe(true);
  });
});
