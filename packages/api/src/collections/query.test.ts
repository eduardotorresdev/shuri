import { describe, expect, it } from "vitest";
import { InvalidQueryError } from "./errors.js";
import { parseQuery } from "./query.js";

describe("parseQuery", () => {
  it("returns an empty query for no params", () => {
    expect(parseQuery(new URLSearchParams())).toEqual({});
  });

  it("reads limit and offset as non-negative integers", () => {
    expect(parseQuery(new URLSearchParams("limit=10&offset=5"))).toEqual({
      limit: 10,
      offset: 5,
    });
  });

  it("rejects a negative or non-integer limit/offset", () => {
    expect(() => parseQuery(new URLSearchParams("limit=-1"))).toThrow(InvalidQueryError);
    expect(() => parseQuery(new URLSearchParams("limit=1.5"))).toThrow(InvalidQueryError);
    expect(() => parseQuery(new URLSearchParams("offset=abc"))).toThrow(
      InvalidQueryError,
    );
  });

  it("reads a valid where filter", () => {
    const params = new URLSearchParams({
      where: JSON.stringify({ name: { op: "eq", value: "Haircut" } }),
    });
    expect(parseQuery(params)).toEqual({
      where: { name: { op: "eq", value: "Haircut" } },
    });
  });

  it("accepts every declared filter op", () => {
    for (const op of ["eq", "ne", "gt", "gte", "lt", "lte", "contains"]) {
      const params = new URLSearchParams({
        where: JSON.stringify({ field: { op, value: "x" } }),
      });
      expect(() => parseQuery(params)).not.toThrow();
    }
    const inParams = new URLSearchParams({
      where: JSON.stringify({ field: { op: "in", value: ["a", "b"] } }),
    });
    expect(() => parseQuery(inParams)).not.toThrow();
  });

  it("rejects where that isn't an object of filters", () => {
    expect(() => parseQuery(new URLSearchParams({ where: "[]" }))).toThrow(
      InvalidQueryError,
    );
    expect(() => parseQuery(new URLSearchParams({ where: "1" }))).toThrow(
      InvalidQueryError,
    );
  });

  it("rejects a filter with an unknown op", () => {
    const params = new URLSearchParams({
      where: JSON.stringify({ name: { op: "startsWith", value: "H" } }),
    });
    expect(() => parseQuery(params)).toThrow(InvalidQueryError);
  });

  it("rejects an 'in' filter whose value isn't an array", () => {
    const params = new URLSearchParams({
      where: JSON.stringify({ name: { op: "in", value: "Haircut" } }),
    });
    expect(() => parseQuery(params)).toThrow(InvalidQueryError);
  });

  it("reads a valid orderBy", () => {
    const params = new URLSearchParams({
      orderBy: JSON.stringify([{ field: "name", direction: "desc" }]),
    });
    expect(parseQuery(params)).toEqual({
      orderBy: [{ field: "name", direction: "desc" }],
    });
  });

  it("rejects an orderBy that isn't an array of { field, direction? }", () => {
    expect(() =>
      parseQuery(new URLSearchParams({ orderBy: JSON.stringify({ field: "name" }) })),
    ).toThrow(InvalidQueryError);
    expect(() =>
      parseQuery(
        new URLSearchParams({
          orderBy: JSON.stringify([{ direction: "asc" }]),
        }),
      ),
    ).toThrow(InvalidQueryError);
    expect(() =>
      parseQuery(
        new URLSearchParams({
          orderBy: JSON.stringify([{ field: "name", direction: "up" }]),
        }),
      ),
    ).toThrow(InvalidQueryError);
  });

  it("throws InvalidQueryError for malformed JSON", () => {
    expect(() => parseQuery(new URLSearchParams({ where: "not json" }))).toThrow(
      InvalidQueryError,
    );
    expect(() => parseQuery(new URLSearchParams({ orderBy: "not json" }))).toThrow(
      InvalidQueryError,
    );
  });
});
