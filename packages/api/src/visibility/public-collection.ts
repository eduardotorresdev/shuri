import { redactRecord, redactRecords } from "@shuri/core";
import type {
  CollectionStore,
  Query,
  RecordId,
  RecordInput,
  StoreRecord,
} from "@shuri/store";
import { assertQueryableFields, assertWritableRecord } from "./guards.js";

/**
 * The five operations REST exposes, and nothing else. Deliberately narrower than `CollectionStore`:
 * no `findOne`/`count`/`subscribe`/`schema`, so a handler holding one of these has no unredacted
 * path available at all. Redacting inside each `jsonResponse` instead would work, right up to the
 * first of the four call sites somebody forgets.
 */
export interface PublicCollection {
  findMany(query?: Query): Promise<StoreRecord[]>;
  get(id: RecordId): Promise<StoreRecord>;
  insert(data: RecordInput): Promise<StoreRecord>;
  update(id: RecordId, data: Partial<RecordInput>): Promise<StoreRecord>;
  delete(id: RecordId): Promise<void>;
}

/**
 * Wraps a `CollectionStore` in the HTTP-facing view of it: reads come back without the fields
 * declared `hidden`, and writes or queries naming one are refused with a `HiddenFieldError`.
 * @param collection - The full collection store to narrow.
 * @returns The public view of `collection`.
 */
export function publicCollection(
  collection: CollectionStore<RecordInput>,
): PublicCollection {
  const { schema } = collection;

  return {
    async findMany(query) {
      if (query) assertQueryableFields(schema, query);
      return redactRecords(schema, await collection.findMany(query));
    },
    async get(id) {
      return redactRecord(schema, await collection.get(id));
    },
    async insert(data) {
      assertWritableRecord(schema, data);
      return redactRecord(schema, await collection.insert(data));
    },
    async update(id, data) {
      assertWritableRecord(schema, data);
      return redactRecord(schema, await collection.update(id, data));
    },
    delete: (id) => collection.delete(id),
  };
}
