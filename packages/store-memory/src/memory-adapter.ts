import { randomUUID } from "node:crypto";
import type { GlobalSchema, Where } from "@shuri/core";
import type { Migratable } from "@shuri/migrate";
import {
  compareValues,
  matchesWhere,
  RecordNotFoundError,
  type OrderBy,
  type Query,
  type StoreAdapter,
  type StoreRecord,
} from "@shuri/store";
import { createMemoryMigrations, type MemoryMigrationsOptions } from "./migrations.js";
import {
  createMemoryState,
  indexRecord,
  tableFor,
  unindexRecord,
  type Table,
} from "./tables.js";

function sortRecords(records: StoreRecord[], orderBy: OrderBy[]): StoreRecord[] {
  return records.toSorted((a, b) => {
    for (const { field, direction = "asc" } of orderBy) {
      const result = compareValues(a[field], b[field]);
      if (result !== 0) return direction === "asc" ? result : -result;
    }
    return 0;
  });
}

/**
 * Takes `limit` records after skipping `offset`, straight off an iterator — no intermediate
 * array of the whole table for the common "first page, no filter" query.
 * @param rows - The records, in table order.
 * @param offset - Records to skip.
 * @param limit - Records to take; `undefined` for all.
 * @returns The page.
 */
function page(rows: Iterable<StoreRecord>, offset = 0, limit?: number): StoreRecord[] {
  const result: StoreRecord[] = [];
  if (limit === 0) return result;
  let skipped = 0;
  for (const record of rows) {
    if (skipped < offset) {
      skipped += 1;
      continue;
    }
    result.push(record);
    if (limit !== undefined && result.length >= limit) break;
  }
  return result;
}

function applyQuery(records: StoreRecord[], query?: Query): StoreRecord[] {
  const where = query?.where;
  let result = where ? records.filter((record) => matchesWhere(record, where)) : records;
  if (query?.orderBy) result = sortRecords(result, query.orderBy);
  return page(result, query?.offset, query?.limit);
}

/**
 * The narrowest set of records an `eq` filter on an indexed field allows, or every row when no
 * such filter is in `where`. The full `where` is still applied to the candidates afterwards.
 * @param table - The table to read.
 * @param where - The query's filters.
 * @returns The candidate records.
 */
function candidates(table: Table, where: Where | undefined): StoreRecord[] {
  if (where) {
    for (const [field, filters] of Object.entries(where)) {
      const index = table.indexes.get(field);
      if (!index) continue;
      for (const filter of Array.isArray(filters) ? filters : [filters]) {
        if (filter.op !== "eq") continue;
        const ids = index.get(filter.value);
        if (!ids) return [];
        return [...ids].map((id) => table.rows.get(id) as StoreRecord);
      }
    }
  }
  return [...table.rows.values()];
}

/** A `StoreAdapter` that is also `Migratable`: `adapter.migrations` is its `MigrationDriver`. */
export type MemoryAdapter = StoreAdapter & Migratable;

/** In-memory `StoreAdapter`, useful for tests and for development before a real database is wired up.
 *
 * Fields declared `index: true` get a secondary index, so a `findMany` with an `eq` filter on one
 * reads that value's records instead of copying and filtering the table — the difference between
 * an authenticated request costing O(1) and O(sessions). An unfiltered, unsorted `findMany` pages
 * straight off the table iterator for the same reason.
 * Migrations: `adapter.migrations` is the `MigrationDriver` of `@shuri/migrate` over the same
 * state, applying each migration copy-on-write.
 * @param options - Test seams for the migration driver.
 * @returns A `StoreAdapter` backed by in-memory tables keyed by collection slug, and migratable.
 */
export function createMemoryAdapter(
  options: MemoryMigrationsOptions = {},
): MemoryAdapter {
  const state = createMemoryState();

  return {
    migrations: createMemoryMigrations(state, options),
    async findMany(collection, query) {
      const table = tableFor(state, collection);
      if (!query?.where && !query?.orderBy) {
        return page(table.rows.values(), query?.offset, query?.limit);
      }
      return applyQuery(candidates(table, query.where), query);
    },
    async findOne(collection, id) {
      return tableFor(state, collection).rows.get(id);
    },
    async count(collection, query) {
      const table = tableFor(state, collection);
      if (!query?.where) {
        const available = Math.max(0, table.rows.size - (query?.offset ?? 0));
        return query?.limit === undefined ? available : Math.min(available, query.limit);
      }
      return applyQuery(candidates(table, query.where), query).length;
    },
    async insert(collection, data) {
      const table = tableFor(state, collection);
      const record: StoreRecord = { ...data, id: randomUUID() };
      table.rows.set(record.id, record);
      indexRecord(table, record);
      return record;
    },
    async update(collection, id, data) {
      const table = tableFor(state, collection);
      const previous = table.rows.get(id);
      if (!previous) throw new RecordNotFoundError(collection.slug, id);

      const updated: StoreRecord = { ...previous, ...data, id };
      unindexRecord(table, previous);
      table.rows.set(id, updated);
      indexRecord(table, updated);
      return updated;
    },
    async delete(collection, id) {
      const table = tableFor(state, collection);
      const record = table.rows.get(id);
      if (!record) return;
      unindexRecord(table, record);
      table.rows.delete(id);
    },
    async findGlobal(global: GlobalSchema) {
      return state.globals.get(global.slug);
    },
    async updateGlobal(global: GlobalSchema, data) {
      const updated = { ...state.globals.get(global.slug), ...data };
      state.globals.set(global.slug, updated);
      return updated;
    },
  };
}
