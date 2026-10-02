import type { CollectionSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import {
  cloneTable,
  createMemoryState,
  indexRecord,
  tableFor,
  unindexRecord,
} from "./tables.js";

const schema = (indexed: string[]): CollectionSchema => ({
  slug: "items",
  title: "Items",
  singular: "Item",
  plural: "Items",
  fields: [
    {
      type: "text",
      name: "title",
      ...(indexed.includes("title") ? { index: true } : {}),
    },
    { type: "text", name: "slug", ...(indexed.includes("slug") ? { index: true } : {}) },
  ],
});

describe("tableFor", () => {
  it("indexes exactly the fields declared index: true", () => {
    const state = createMemoryState();
    const table = tableFor(state, schema(["title"]));
    expect([...table.indexes.keys()]).toEqual(["title"]);
  });

  it("keeps the same indexes while the schema reference is the same", () => {
    const state = createMemoryState();
    const items = schema(["title"]);
    const first = tableFor(state, items);
    const indexes = first.indexes;
    expect(tableFor(state, items).indexes).toBe(indexes);
  });

  it("rebuilds the indexes, filled from the rows, when the schema reference changes", () => {
    const state = createMemoryState();
    const table = tableFor(state, schema([]));
    for (const [id, slug] of [
      ["1", "x"],
      ["2", "y"],
      ["3", "x"],
    ]) {
      const record = { id, title: "t", slug };
      table.rows.set(id, record);
      indexRecord(table, record);
    }
    expect(table.indexes.size).toBe(0);

    const reloaded = tableFor(state, schema(["slug"]));
    expect(reloaded).toBe(table);
    expect([...(reloaded.indexes.get("slug")?.get("x") ?? [])]).toEqual(["1", "3"]);
    expect([...(reloaded.indexes.get("slug")?.get("y") ?? [])]).toEqual(["2"]);

    // Dropping the index in a later schema drops the structure too.
    expect(tableFor(state, schema([])).indexes.size).toBe(0);
  });
});

describe("unindexRecord", () => {
  it("forgets a value once no record holds it", () => {
    const state = createMemoryState();
    const table = tableFor(state, schema(["title"]));
    const record = { id: "1", title: "a" };
    indexRecord(table, record);
    unindexRecord(table, record);
    expect(table.indexes.get("title")?.has("a")).toBe(false);
  });
});

describe("cloneTable", () => {
  it("copies the rows so changes to the copy never reach the original", () => {
    const state = createMemoryState();
    const table = tableFor(state, schema(["title"]));
    table.rows.set("1", { id: "1", title: "a" });

    const copy = cloneTable(table);
    const row = copy.rows.get("1");
    if (row) row.title = "changed";
    copy.rows.delete("1");

    expect(table.rows.get("1")).toEqual({ id: "1", title: "a" });
  });

  it("leaves the copy to be reindexed on next use", () => {
    const state = createMemoryState();
    const items = schema(["title"]);
    const table = tableFor(state, items);
    const record = { id: "1", title: "a" };
    table.rows.set("1", record);
    indexRecord(table, record);

    state.tables.set("items", cloneTable(table));
    const copied = tableFor(state, items);
    expect([...(copied.indexes.get("title")?.get("a") ?? [])]).toEqual(["1"]);
  });
});
