import type { CollectionSchema } from "@shuri/core";
import type { StoreAdapter } from "../adapter.js";
import type { RecordId, RecordInput, StoreRecord } from "../record.js";
import { assertValidRecord } from "../validate-record.js";
import { RecordNotFoundError } from "./errors.js";
import type { Query } from "./query.js";

/** Persistence operations scoped to a single collection. */
export interface CollectionStore<R = RecordInput> {
  findMany(query?: Query): Promise<StoreRecord<R>[]>;
  findOne(id: RecordId): Promise<StoreRecord<R> | undefined>;
  /** Throws `RecordNotFoundError` when the record doesn't exist, like `findOne` returns `undefined`. */
  get(id: RecordId): Promise<StoreRecord<R>>;
  count(query?: Query): Promise<number>;
  insert(data: R): Promise<StoreRecord<R>>;
  update(id: RecordId, data: Partial<R>): Promise<StoreRecord<R>>;
  delete(id: RecordId): Promise<void>;
}

export function bindCollection(
  collection: CollectionSchema,
  adapter: StoreAdapter,
): CollectionStore {
  return {
    findMany: (query) => adapter.findMany(collection, query),
    findOne: (id) => adapter.findOne(collection, id),
    async get(id) {
      const record = await adapter.findOne(collection, id);
      if (!record) throw new RecordNotFoundError(collection.slug, id);
      return record;
    },
    count: (query) => adapter.count(collection, query),
    async insert(data) {
      assertValidRecord(collection, data);
      return adapter.insert(collection, data);
    },
    async update(id, data) {
      assertValidRecord(collection, data, { partial: true });
      return adapter.update(collection, id, data);
    },
    delete: (id) => adapter.delete(collection, id),
  };
}
