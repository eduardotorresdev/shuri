import { redactRecord, redactRecords, type OperationContext } from "@shuri/core";
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
 * declared `hidden`, and writes or queries naming one are refused with a `HiddenFieldError`. Every
 * store call is made with `context`, so the collection's hooks see the request behind it.
 * @param collection - The full collection store to narrow.
 * @param context - The request's operation context, forwarded to every store call.
 * @returns The public view of `collection`.
 */
export function publicCollection(
  collection: CollectionStore<RecordInput>,
  context: OperationContext,
): PublicCollection {
  const { schema } = collection;

  return {
    async findMany(query) {
      if (query) assertQueryableFields(schema, query);
      return redactRecords(schema, await collection.findMany(query, context));
    },
    async get(id) {
      return redactRecord(schema, await collection.get(id, context));
    },
    async insert(data) {
      assertWritableRecord(schema, data);
      return redactRecord(schema, await collection.insert(data, context));
    },
    async update(id, data) {
      assertWritableRecord(schema, data);
      return redactRecord(schema, await collection.update(id, data, context));
    },
    delete: (id) => collection.delete(id, context),
  };
}
