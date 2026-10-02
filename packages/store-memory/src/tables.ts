import type { CollectionSchema } from "@shuri/core";
import type { RecordId, RecordInput, StoreRecord } from "@shuri/store";

/** A secondary index: field value -> the ids of the records holding it. */
export type FieldIndex = Map<unknown, Set<RecordId>>;

export interface Table {
  rows: Map<RecordId, StoreRecord>;
  /** One index per field declared `index: true`, keyed by field name. */
  indexes: Map<string, FieldIndex>;
  /**
   * The schema the indexes were built for: the last reference seen. A different reference means
   * the schema changed (a migration, a hot reload), so the indexes are rebuilt from it.
   */
  schema: CollectionSchema | undefined;
}

/** Everything the memory store holds. The adapter and the migration driver share one. */
export interface MemoryState {
  /** One table per collection slug. */
  tables: Map<string, Table>;
  /** One document per global slug. */
  globals: Map<string, RecordInput>;
}

/** @returns Empty state. */
export function createMemoryState(): MemoryState {
  return { tables: new Map(), globals: new Map() };
}

export function indexRecord(table: Table, record: StoreRecord): void {
  for (const [field, index] of table.indexes) {
    const value = record[field];
    let ids = index.get(value);
    if (!ids) {
      ids = new Set();
      index.set(value, ids);
    }
    ids.add(record.id);
  }
}

export function unindexRecord(table: Table, record: StoreRecord): void {
  for (const [field, index] of table.indexes) {
    const ids = index.get(record[field]);
    if (!ids) continue;
    ids.delete(record.id);
    if (ids.size === 0) index.delete(record[field]);
  }
}

/**
 * Rebuilds a table's indexes from a schema: one per field declared `index: true`, filled from the
 * rows already there.
 * @param table - The table to index.
 * @param collection - The schema that says which fields are indexed.
 */
export function rebuildIndexes(table: Table, collection: CollectionSchema): void {
  table.indexes = new Map();
  for (const field of collection.fields) {
    if (field.index) table.indexes.set(field.name, new Map());
  }
  table.schema = collection;
  for (const record of table.rows.values()) indexRecord(table, record);
}

/**
 * The table for a collection. The first call creates it; a call with a schema object other than
 * the last one seen rebuilds its indexes, so a schema that changed at runtime is honoured. With a
 * stable schema this is a map lookup and a reference comparison.
 * @param state - The store's state.
 * @param collection - The collection.
 * @returns Its table, indexed per `collection`.
 */
export function tableFor(state: MemoryState, collection: CollectionSchema): Table {
  let table = state.tables.get(collection.slug);
  if (!table) {
    table = { rows: new Map(), indexes: new Map(), schema: undefined };
    state.tables.set(collection.slug, table);
  }
  if (table.schema !== collection) rebuildIndexes(table, collection);
  return table;
}

/**
 * A deep copy of one table, for a migration to write to. Indexes are not copied: the copy has no
 * `schema`, so its indexes are rebuilt the next time it is read.
 * @param table - The table to copy.
 * @returns An independent copy.
 */
export function cloneTable(table: Table): Table {
  return { rows: structuredClone(table.rows), indexes: new Map(), schema: undefined };
}
