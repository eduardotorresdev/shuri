import type { CollectionSchema } from "@shuri/core";
import {
  RecordNotFoundError,
  UnknownCollectionError,
  type CollectionStore,
  type RecordId,
  type RecordInput,
  type Store,
  type StoreRecord,
} from "@shuri/store";

/** Test-only fixtures shared by this package's unit tests, kept independent of `@shuri/sdk`/`@shuri/store-memory`. */
export const servicesSchema: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [{ type: "text", name: "name", required: true }],
};

export function createFakeCollectionStore(): CollectionStore<RecordInput> {
  const records = new Map<RecordId, StoreRecord>();
  let nextId = 1;

  return {
    async findMany() {
      return [...records.values()];
    },
    async findOne(id) {
      return records.get(id);
    },
    async get(id) {
      const record = records.get(id);
      if (!record) throw new RecordNotFoundError("services", id);
      return record;
    },
    async count() {
      return records.size;
    },
    async insert(data) {
      const record: StoreRecord = { ...data, id: String(nextId++) };
      records.set(record.id, record);
      return record;
    },
    async update(id, data) {
      const existing = records.get(id);
      if (!existing) throw new RecordNotFoundError("services", id);
      const updated: StoreRecord = { ...existing, ...data, id };
      records.set(id, updated);
      return updated;
    },
    async delete(id) {
      records.delete(id);
    },
  };
}

/** Fake `{ store }` exposing a single "services" collection, for handler-level unit tests. */
export function createFakeApp(collection: CollectionStore<RecordInput> = createFakeCollectionStore()): { store: Store } {
  const store = {
    collection: (slug: string) => {
      if (slug !== "services") throw new UnknownCollectionError(slug);
      return collection;
    },
  } as unknown as Store;
  return { store };
}
