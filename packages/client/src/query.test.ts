import { describe, expect, it } from "vitest";
import { toSearchParams } from "./query.js";

describe("toSearchParams", () => {
  it("leaves absent keys out and encodes where/orderBy as JSON", () => {
    expect(toSearchParams().toString()).toBe("");
    expect(toSearchParams({ limit: 0, offset: 5 }).toString()).toBe("limit=0&offset=5");
    const params = toSearchParams({
      where: { title: { op: "eq", value: "a" } },
      orderBy: [{ field: "title" }],
    });
    expect(JSON.parse(params.get("where") as string)).toEqual({
      title: { op: "eq", value: "a" },
    });
    expect(JSON.parse(params.get("orderBy") as string)).toEqual([{ field: "title" }]);
  });
});
