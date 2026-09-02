import type { CollectionSchema, Core, InferCollections } from "@shuri/core";
import type { StoreAdapter } from "./adapter.js";
import { RecordNotFoundError } from "./errors.js";
import type { Query } from "./query.js";
import type { RecordId, RecordInput, StoreRecord } from "./record.js";

/** Persistence operations scoped to a single collection. */
export interface CollectionStore<R = RecordInput> {
  findMany(query?: Query): Promise<StoreRecord<R>[]>;
  findOne(id: RecordId): Promise<StoreRecord<R> | undefined>;
  /** Like `findOne`, but throws `RecordNotFoundError` instead of returning `undefined`. */
  get(id: RecordId): Promise<StoreRecord<R>>;
  count(query?: Query): Promise<number>;
  insert(data: R): Promise<StoreRecord<R>>;
  update(id: RecordId, data: Partial<R>): Promise<StoreRecord<R>>;
  delete(id: RecordId): Promise<void>;
}

/**
 * Single persistence entry point for every collection declared on a `Core`, backed by one adapter.
 * `collection(slug)` is typed per the fields declared for that slug: `T` flows in from `createCore`.
 */
export interface Store<T extends readonly CollectionSchema[] = CollectionSchema[]> {
  collection<S extends T[number]["slug"]>(slug: S): CollectionStore<InferCollections<T>[S]>;
}

function bindCollection(collection: CollectionSchema, adapter: StoreAdapter): CollectionStore {
  return {
    findMany: (query) => adapter.findMany(collection, query),
    findOne: (id) => adapter.findOne(collection, id),
    async get(id) {
      const record = await adapter.findOne(collection, id);
      if (!record) throw new RecordNotFoundError(collection.slug, id);
      return record;
    },
    count: (query) => adapter.count(collection, query),
    insert: (data) => adapter.insert(collection, data),
    update: (id, data) => adapter.update(collection, id, data),
    delete: (id) => adapter.delete(collection, id),
  };
}

/** Wires every collection declared on `core` to `adapter`, resolving one `CollectionStore` per slug. */
export function createStore<T extends readonly CollectionSchema[]>(core: Core<T>, adapter: StoreAdapter): Store<T> {
  const collections = new Map<string, CollectionStore>();

  return {
    collection(slug: string) {
      const cached = collections.get(slug);
      if (cached) return cached as never;

      const schema = core.getCollection(slug as T[number]["slug"]);
      if (!schema) throw new Error(`Unknown collection "${slug}"`);

      const bound = bindCollection(schema as unknown as CollectionSchema, adapter);
      collections.set(slug, bound);
      return bound as never;
    },
  };
}
