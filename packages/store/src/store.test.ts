import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { createCore } from "@shuri/core";
import { describe, expect, it } from "vitest";
import type { StoreAdapter } from "./adapter.js";
import { UnknownCollectionError } from "./collections/errors.js";
import { UnknownGlobalError } from "./globals/errors.js";
import type { RecordId, RecordInput, StoreRecord } from "./record.js";
import { createStore } from "./store.js";

const services: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [{ type: "text", name: "name", required: true }],
};

const siteSettings: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name", required: true }],
};

/**
 * Minimal `StoreAdapter` test double, just enough to exercise the `Store` facade.
 * @returns An in-memory `StoreAdapter` test double.
 */
function createFakeAdapter(): StoreAdapter {
  const records = new Map<RecordId, StoreRecord>();
  const globalRecords = new Map<string, RecordInput>();
  let nextId = 1;

  return {
    async findMany() {
      return [...records.values()];
    },
    async findOne(_collection, id) {
      return records.get(id);
    },
    async count() {
      return records.size;
    },
    async insert(_collection, data) {
      const record: StoreRecord = { ...data, id: String(nextId++) };
      records.set(record.id, record);
      return record;
    },
    async update(_collection, id, data) {
      const existing = records.get(id);
      const updated: StoreRecord = { ...existing, ...data, id };
      records.set(id, updated);
      return updated;
    },
    async delete(_collection, id) {
      records.delete(id);
    },
    async findGlobal(global) {
      return globalRecords.get(global.slug);
    },
    async updateGlobal(global, data) {
      const updated = { ...globalRecords.get(global.slug), ...data };
      globalRecords.set(global.slug, updated);
      return updated;
    },
  };
}

describe("Store.collection", () => {
  it("resolves a collection store per slug declared on the core", async () => {
    const core = createCore({ collections: [services] });
    const store = createStore(core, createFakeAdapter());

    const record = await store.collection("services").insert({ name: "Haircut" });
    expect(await store.collection("services").findOne(record.id)).toEqual(record);
  });

  it("returns the same collection store instance for repeated lookups", () => {
    const core = createCore({ collections: [services] });
    const store = createStore(core, createFakeAdapter());
    expect(store.collection("services")).toBe(store.collection("services"));
  });

  it("throws for an unknown collection slug", () => {
    const core = createCore({ collections: [services] });
    const store = createStore(core, createFakeAdapter());
    expect(() => store.collection("unknown" as never)).toThrow(UnknownCollectionError);
  });
});

describe("Store.global", () => {
  it("returns the same global store instance for repeated lookups", () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    expect(store.global("site")).toBe(store.global("site"));
  });

  it("throws for an unknown global slug", () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    expect(() => store.global("unknown" as never)).toThrow(UnknownGlobalError);
  });
});
