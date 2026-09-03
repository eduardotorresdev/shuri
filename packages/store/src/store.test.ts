import type { CollectionSchema } from "@shuri/core";
import { createCore } from "@shuri/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreAdapter } from "./adapter.js";
import { RecordNotFoundError, RecordValidationError, UnknownCollectionError } from "./errors.js";
import type { RecordId, RecordInput, StoreRecord } from "./record.js";
import { createStore, type CollectionStore } from "./store.js";

const services: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [
    { type: "text", name: "name", required: true },
    { type: "number", name: "price", kind: "float", sign: "positive" },
  ],
};

/**
 * Minimal `StoreAdapter` test double, just enough to exercise the `Store` facade.
 * @returns An in-memory `StoreAdapter` test double.
 */
function createFakeAdapter(): StoreAdapter {
  const records = new Map<RecordId, StoreRecord>();
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
    async insert(_collection, data: RecordInput) {
      const record: StoreRecord = { ...data, id: String(nextId++) };
      records.set(record.id, record);
      return record;
    },
    async update(collection, id, data) {
      const existing = records.get(id);
      if (!existing) throw new RecordNotFoundError(collection.slug, id);
      const updated: StoreRecord = { ...existing, ...data, id };
      records.set(id, updated);
      return updated;
    },
    async delete(_collection, id) {
      records.delete(id);
    },
  };
}

describe("createStore", () => {
  let collection: CollectionStore;

  beforeEach(() => {
    const core = createCore({ collections: [services] });
    collection = createStore(core, createFakeAdapter()).collection("services");
  });

  it("inserts a record and assigns it an id", async () => {
    const record = await collection.insert({ name: "Haircut", price: 40 });
    expect(record.id).toBeTruthy();
    expect(record).toMatchObject({ name: "Haircut", price: 40 });
  });

  it("finds a record by id", async () => {
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    expect(await collection.findOne(inserted.id)).toEqual(inserted);
    expect(await collection.findOne("missing")).toBeUndefined();
  });

  it("throws when getting a record that doesn't exist", async () => {
    await expect(collection.get("missing")).rejects.toThrow(RecordNotFoundError);
  });

  it("updates an existing record, merging fields", async () => {
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    const updated = await collection.update(inserted.id, { price: 50 });
    expect(updated).toEqual({ id: inserted.id, name: "Haircut", price: 50 });
  });

  it("throws when updating a record that doesn't exist", async () => {
    await expect(collection.update("missing", { price: 50 })).rejects.toThrow(RecordNotFoundError);
  });

  it("deletes a record", async () => {
    const inserted = await collection.insert({ name: "Haircut", price: 40 });
    await collection.delete(inserted.id);
    expect(await collection.findOne(inserted.id)).toBeUndefined();
  });

  it("counts records", async () => {
    await collection.insert({ name: "Haircut", price: 40 });
    await collection.insert({ name: "Massage", price: 80 });
    expect(await collection.count()).toBe(2);
  });

  it("rejects an insert that doesn't satisfy the collection's fields, without touching the adapter", async () => {
    const adapter = createFakeAdapter();
    const spiedInsert = vi.spyOn(adapter, "insert");
    const invalidCollection = createStore(createCore({ collections: [services] }), adapter).collection("services");

    await expect(invalidCollection.insert({ price: 40 })).rejects.toThrow(RecordValidationError);
    expect(spiedInsert).not.toHaveBeenCalled();
  });

  it("rejects an update that doesn't satisfy the collection's fields, without touching the adapter", async () => {
    const adapter = createFakeAdapter();
    const spiedUpdate = vi.spyOn(adapter, "update");
    const guardedCollection = createStore(createCore({ collections: [services] }), adapter).collection("services");
    const inserted = await guardedCollection.insert({ name: "Haircut", price: 40 });
    spiedUpdate.mockClear();

    await expect(guardedCollection.update(inserted.id, { price: -10 })).rejects.toThrow(RecordValidationError);
    expect(spiedUpdate).not.toHaveBeenCalled();
  });
});

describe("Store.collection", () => {
  it("resolves a collection store per slug declared on the core", async () => {
    const core = createCore({ collections: [services] });
    const store = createStore(core, createFakeAdapter());

    const record = await store.collection("services").insert({ name: "Haircut", price: 40 });
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
