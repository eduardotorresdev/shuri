import type { StoreAdapter } from "./adapter.js";
import { RecordNotFoundError } from "./collections/errors.js";
import type { RecordId, RecordInput, StoreRecord } from "./record.js";

/**
 * Minimal in-memory `StoreAdapter` test double, shared by this package's store tests: just enough
 * behavior to exercise `Store`/`CollectionStore`/`GlobalStore` without depending on
 * `@shuri/store-memory` (which depends on this package).
 * @returns An in-memory `StoreAdapter` test double.
 */
export function createFakeAdapter(): StoreAdapter {
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
