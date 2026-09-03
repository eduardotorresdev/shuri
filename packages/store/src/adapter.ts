import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { Query } from "./collections/query.js";
import type { RecordId, RecordInput, StoreRecord } from "./record.js";

/**
 * Persistence port implemented once per database engine (sqlite, postgres, in-memory, ...).
 * Every method receives the `CollectionSchema`/`GlobalSchema` it operates on so an adapter can
 * translate the engine-agnostic `Query` AST into its own native query language.
 */
export interface StoreAdapter {
  findMany(collection: CollectionSchema, query?: Query): Promise<StoreRecord[]>;
  findOne(collection: CollectionSchema, id: RecordId): Promise<StoreRecord | undefined>;
  count(collection: CollectionSchema, query?: Query): Promise<number>;
  insert(collection: CollectionSchema, data: RecordInput): Promise<StoreRecord>;
  update(
    collection: CollectionSchema,
    id: RecordId,
    data: RecordInput,
  ): Promise<StoreRecord>;
  delete(collection: CollectionSchema, id: RecordId): Promise<void>;
  findGlobal(global: GlobalSchema): Promise<RecordInput | undefined>;
  updateGlobal(global: GlobalSchema, data: RecordInput): Promise<RecordInput>;
}
