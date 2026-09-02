import { randomUUID } from "node:crypto";
import type { CollectionSchema } from "@shuri/core";
import {
  RecordNotFoundError,
  type FilterOp,
  type OrderBy,
  type Query,
  type RecordId,
  type StoreAdapter,
  type StoreRecord,
  type Where,
} from "@shuri/store";

/** Orders two values of the same primitive type; unordered/mismatched types compare as equal. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return 0;
}

function matchesFilter(value: unknown, filter: FilterOp): boolean {
  switch (filter.op) {
    case "eq":
      return value === filter.value;
    case "ne":
      return value !== filter.value;
    case "gt":
      return compare(value, filter.value) > 0;
    case "gte":
      return compare(value, filter.value) >= 0;
    case "lt":
      return compare(value, filter.value) < 0;
    case "lte":
      return compare(value, filter.value) <= 0;
    case "in":
      return filter.value.includes(value);
    case "contains":
      return typeof value === "string" && value.includes(filter.value);
  }
}

function matchesWhere(record: StoreRecord, where: Where): boolean {
  return Object.entries(where).every(([field, filter]) => matchesFilter(record[field], filter));
}

function sortRecords(records: StoreRecord[], orderBy: OrderBy[]): StoreRecord[] {
  return [...records].sort((a, b) => {
    for (const { field, direction = "asc" } of orderBy) {
      const result = compare(a[field], b[field]);
      if (result !== 0) return direction === "asc" ? result : -result;
    }
    return 0;
  });
}

function applyQuery(records: StoreRecord[], query?: Query): StoreRecord[] {
  let result = query?.where ? records.filter((record) => matchesWhere(record, query.where!)) : records;
  if (query?.orderBy) result = sortRecords(result, query.orderBy);
  if (query?.offset) result = result.slice(query.offset);
  if (query?.limit !== undefined) result = result.slice(0, query.limit);
  return result;
}

/** In-memory `StoreAdapter`, useful for tests and for development before a real database is wired up. */
export function createMemoryAdapter(): StoreAdapter {
  const tables = new Map<string, Map<RecordId, StoreRecord>>();

  function tableFor(collection: CollectionSchema): Map<RecordId, StoreRecord> {
    let table = tables.get(collection.slug);
    if (!table) {
      table = new Map();
      tables.set(collection.slug, table);
    }
    return table;
  }

  return {
    async findMany(collection, query) {
      return applyQuery([...tableFor(collection).values()], query);
    },
    async findOne(collection, id) {
      return tableFor(collection).get(id);
    },
    async count(collection, query) {
      return applyQuery([...tableFor(collection).values()], query).length;
    },
    async insert(collection, data) {
      const record: StoreRecord = { ...data, id: randomUUID() };
      tableFor(collection).set(record.id, record);
      return record;
    },
    async update(collection, id, data) {
      const table = tableFor(collection);
      if (!table.has(id)) throw new RecordNotFoundError(collection.slug, id);

      const updated: StoreRecord = { ...table.get(id), ...data, id };
      table.set(id, updated);
      return updated;
    },
    async delete(collection, id) {
      tableFor(collection).delete(id);
    },
  };
}
