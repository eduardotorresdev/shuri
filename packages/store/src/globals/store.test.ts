import type { GlobalSchema } from "@shuri/core";
import { createCore } from "@shuri/core";
import { describe, expect, it, vi } from "vitest";
import type { StoreAdapter } from "../adapter.js";
import { RecordValidationError } from "../errors.js";
import type { RecordInput } from "../record.js";
import { createStore } from "../store.js";

const siteSettings: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [
    { type: "text", name: "name", required: true },
    { type: "number", name: "visits", kind: "integer", sign: "positive" },
  ],
};

/**
 * Minimal `StoreAdapter` test double, just enough to exercise `GlobalStore`.
 * @returns An in-memory `StoreAdapter` test double.
 */
function createFakeAdapter(): StoreAdapter {
  const globalRecords = new Map<string, RecordInput>();

  return {
    async findMany() {
      return [];
    },
    async findOne() {
      return undefined;
    },
    async count() {
      return 0;
    },
    async insert(_collection, data) {
      return { ...data, id: "1" };
    },
    async update(_collection, id, data) {
      return { ...data, id };
    },
    async delete() {},
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

describe("GlobalStore", () => {
  it("returns an empty object before the first update", async () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    expect(await store.global("site").get()).toEqual({});
  });

  it("updates the global record, merging fields", async () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());

    await store.global("site").update({ name: "Acme" });
    expect(await store.global("site").get()).toEqual({ name: "Acme" });

    await store.global("site").update({ name: "Acme Co" });
    expect(await store.global("site").get()).toEqual({ name: "Acme Co" });
  });

  it("rejects an update that doesn't satisfy the global's fields, without touching the adapter", async () => {
    const adapter = createFakeAdapter();
    const spiedUpdate = vi.spyOn(adapter, "updateGlobal");
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, adapter);

    await expect(store.global("site").update({ visits: -1 })).rejects.toThrow(
      RecordValidationError,
    );
    expect(spiedUpdate).not.toHaveBeenCalled();
  });
});
