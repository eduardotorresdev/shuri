import type { CollectionSchema } from "@shuri/core";
import type { StoreAdapter } from "../adapter.js";
import type { StoreEventBus } from "../events/bus.js";
import type {
  CollectionEvent,
  RecordEvent,
  StoreEvent,
  StoreEventListener,
  Unsubscribe,
} from "../events/types.js";
import type { RecordId, RecordInput, StoreRecord } from "../record.js";
import { assertValidRecord } from "../validate-record.js";
import { RecordNotFoundError } from "./errors.js";
import type { Query } from "./query.js";

/**
 * Listens to this collection's events, either all of them or only one record's. Declared as an
 * overloaded call signature (rather than an overloaded method) so the implementation is a single
 * arrow checked against both signatures at once.
 */
export interface CollectionSubscribe<R = RecordInput> {
  /** Every create, update and delete of this collection. */
  (listener: StoreEventListener<CollectionEvent<R>>): Unsubscribe;
  /** Only the updates and deletes of `id` — whoever already holds an id can't be told of its creation. */
  (id: RecordId, listener: StoreEventListener<RecordEvent<R>>): Unsubscribe;
}

/** Persistence operations scoped to a single collection. */
export interface CollectionStore<R = RecordInput> {
  findMany(query?: Query): Promise<StoreRecord<R>[]>;
  findOne(id: RecordId): Promise<StoreRecord<R> | undefined>;
  /** Throws `RecordNotFoundError` when the record doesn't exist, like `findOne` returns `undefined`. */
  get(id: RecordId): Promise<StoreRecord<R>>;
  count(query?: Query): Promise<number>;
  insert(data: R): Promise<StoreRecord<R>>;
  update(id: RecordId, data: Partial<R>): Promise<StoreRecord<R>>;
  /**
   * Emits a `delete` event whenever the adapter accepts the call, including for an id that never
   * existed: the adapter resolves to `void` and no pre-check is run, so the event means "a delete
   * was accepted", not "a record stopped existing".
   */
  delete(id: RecordId): Promise<void>;
  /** Subscribes to this collection's events, or to a single record's. Returns the unsubscribe function. */
  subscribe: CollectionSubscribe<R>;
}

/**
 * Binds one collection's CRUD to `adapter`, publishing every accepted write to `events`. Emission
 * happens after the adapter resolves and before the caller's `await` does, so a write that throws
 * (validation or adapter) emits nothing, and every listener has already run by the time
 * `await insert(...)` returns.
 * @param collection - The schema of the collection being bound.
 * @param adapter - The persistence adapter backing the collection.
 * @param events - The bus every accepted write is published to.
 * @returns The `CollectionStore` for `collection`.
 */
export function bindCollection(
  collection: CollectionSchema,
  adapter: StoreAdapter,
  events: StoreEventBus,
): CollectionStore {
  const isOwnEvent = (event: StoreEvent): event is CollectionEvent =>
    event.scope === "collection" && event.collection === collection.slug;

  const subscribe: CollectionSubscribe = (
    idOrListener: RecordId | StoreEventListener<CollectionEvent>,
    maybeListener?: StoreEventListener<RecordEvent>,
  ): Unsubscribe => {
    // Arity dispatch for the overloaded signature above, not input validation.
    if (maybeListener === undefined) {
      const listener = idOrListener as StoreEventListener<CollectionEvent>;
      return events.subscribe((event) => {
        if (isOwnEvent(event)) listener(event);
      });
    }

    const id = idOrListener as RecordId;
    return events.subscribe((event) => {
      if (isOwnEvent(event) && event.type !== "create" && event.id === id)
        maybeListener(event);
    });
  };

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
      const record = await adapter.insert(collection, data);
      events.emit({
        scope: "collection",
        type: "create",
        collection: collection.slug,
        id: record.id,
        record,
      });
      return record;
    },
    async update(id, data) {
      assertValidRecord(collection, data, { partial: true });
      const record = await adapter.update(collection, id, data);
      events.emit({
        scope: "collection",
        type: "update",
        collection: collection.slug,
        id: record.id,
        record,
      });
      return record;
    },
    async delete(id) {
      await adapter.delete(collection, id);
      events.emit({
        scope: "collection",
        type: "delete",
        collection: collection.slug,
        id,
      });
    },
    subscribe,
  };
}
