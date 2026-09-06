import type { StoreRecord } from "@shuri/store";
import { describe, expect, it } from "vitest";
import { sortRecords } from "./sort.js";

const rows = (...values: unknown[]): StoreRecord[] =>
  values.map((value, index) => ({ id: String(index), value }) as StoreRecord);

const values = (records: StoreRecord[]): unknown[] =>
  records.map((record) => (record as Record<string, unknown>)["value"]);

describe("sortRecords", () => {
  it("orders strings ascending and descending", () => {
    expect(
      values(sortRecords(rows("c", "a", "b"), { field: "value", direction: "asc" })),
    ).toEqual(["a", "b", "c"]);
    expect(
      values(sortRecords(rows("c", "a", "b"), { field: "value", direction: "desc" })),
    ).toEqual(["c", "b", "a"]);
  });

  it("orders numbers by value, not by their string form", () => {
    expect(
      values(sortRecords(rows(10, 9, 100), { field: "value", direction: "asc" })),
    ).toEqual([9, 10, 100]);
  });

  it("orders ISO dates correctly as strings, which is how they are stored", () => {
    const sorted = sortRecords(
      rows("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      { field: "value", direction: "asc" },
    );

    expect(values(sorted)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ]);
  });

  it("puts absent values first ascending and last descending", () => {
    expect(
      values(
        sortRecords(rows("b", undefined, "a"), { field: "value", direction: "asc" }),
      )[0],
    ).toBeUndefined();
    expect(
      values(
        sortRecords(rows("b", undefined, "a"), { field: "value", direction: "desc" }),
      ).at(-1),
    ).toBeUndefined();
  });

  it("orders booleans false before true", () => {
    expect(
      values(sortRecords(rows(true, false), { field: "value", direction: "asc" })),
    ).toEqual([false, true]);
  });
});
