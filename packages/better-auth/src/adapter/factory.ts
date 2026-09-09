import { createAdapterFactory, type CleanedWhere } from "better-auth/adapters";
import type { CollectionStore, RecordInput, StoreRecord } from "@shuri/store";
import { matchesWhere } from "./match.js";
import { sortRecords, type SortBy } from "./sort.js";
import { toStoreQuery } from "./where.js";

/** The slice of `@shuri/store` this adapter needs: one `CollectionStore` per better-auth table. */
export interface CollectionResolver {
  collection(slug: string): CollectionStore<RecordInput>;
}

export interface CreateShuriAdapterOptions {
  /** Logs every translated query. Forwarded to better-auth's own adapter debug logging. */
  debugLogs?: boolean;
}

/**
 * Narrows a record to the columns better-auth asked for. The store has no projection of its own, so
 * the read is whole and the trimming happens here.
 * @param record - The stored record.
 * @param [select] - The columns to keep; all of them when absent or empty.
 * @returns The record, trimmed.
 */
function project(record: RecordInput, select?: readonly string[]): RecordInput {
  if (!select || select.length === 0) return record;
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => select.includes(key)),
  );
}

/**
 * Runs a read, pushing the filter down to the store when it can express it and falling back to
 * filtering here when it cannot.
 * @param collection - The store for the table being read.
 * @param where - The clauses better-auth is asking for.
 * @param [page] - The `limit`/`offset` to apply.
 * @param [sortBy] - The ordering to apply.
 * @returns The matching records.
 */
async function read(
  collection: CollectionStore<RecordInput>,
  where: readonly CleanedWhere[],
  page?: { limit?: number; offset?: number },
  sortBy?: SortBy,
): Promise<StoreRecord<RecordInput>[]> {
  const orderBy = sortBy
    ? [{ field: sortBy.field, direction: sortBy.direction }]
    : undefined;
  const { query, filtered } = toStoreQuery(where, page);

  const records = await collection.findMany(
    filtered && orderBy ? { ...query, orderBy } : query,
  );
  if (filtered) return records;

  // The store answered a wider question than better-auth asked, so the narrowing, the ordering and
  // the page all happen here — in that order, or the page would be cut from the wrong set.
  const matched = records.filter((record) => matchesWhere(record, where));
  const ordered = sortBy ? sortRecords(matched, sortBy) : matched;
  const offset = page?.offset ?? 0;
  return page?.limit === undefined
    ? ordered.slice(offset)
    : ordered.slice(offset, offset + page.limit);
}

/**
 * A better-auth database adapter backed by `@shuri/store`, so better-auth's four tables live in the
 * app's own store — same persistence adapter, same validation, same event bus, no second database.
 *
 * Three things about the store shape this has to work around:
 *
 * - **Ids are the store's.** `insert` rejects a payload carrying one, so the adapter is built with
 *   `disableIdGeneration`, and better-auth reads back the id the store assigned.
 * - **Writes address a row by id, not by a filter.** better-auth's `update`/`delete` take a `where`,
 *   so each becomes a read followed by a write. Two round trips, and not atomic — see the package
 *   guide for what that costs.
 * - **`Query.where` is one operator per field, `AND` only.** Anything richer is evaluated in
 *   memory by `match.ts`; see `where.ts#isPushable` for exactly what crosses that line.
 * @param store - The store resolving each better-auth table.
 * @param [options] - Adapter options, e.g. `debugLogs`.
 * @returns The adapter factory to hand better-auth's `database` option.
 */
export function createShuriAdapter(
  store: CollectionResolver,
  options: CreateShuriAdapterOptions = {},
) {
  const tableOf = (model: string): CollectionStore<RecordInput> =>
    store.collection(model);

  return createAdapterFactory({
    config: {
      adapterId: "shuri",
      adapterName: "Shuri Store Adapter",
      usePlural: false,
      debugLogs: options.debugLogs ?? false,
      // The store generates every id and refuses one in the payload.
      disableIdGeneration: true,
      supportsNumericIds: false,
      // `@shuri/core` has no date, JSON or array field, so better-auth serializes all three to
      // strings and we store text. Dates become ISO-8601, which orders correctly as a string.
      supportsDates: false,
      supportsJSON: false,
      supportsArrays: false,
      supportsBooleans: true,
    },
    adapter: () => ({
      async create({ model, data, select }) {
        // Defensive: `disableIdGeneration` should mean no id arrives, and the store would reject one.
        const { id: _generated, ...input } = data as RecordInput;
        const created = await tableOf(model).insert(input);
        return project(created, select) as never;
      },

      async findOne({ model, where, select }) {
        const [found] = await read(tableOf(model), where, { limit: 1 });
        return found ? (project(found, select) as never) : null;
      },

      async findMany({ model, where, limit, sortBy, offset, select }) {
        const found = await read(tableOf(model), where ?? [], { limit, offset }, sortBy);
        return found.map((record) => project(record, select)) as never;
      },

      async count({ model, where }) {
        return (await read(tableOf(model), where ?? [])).length;
      },

      async update({ model, where, update }) {
        const collection = tableOf(model);
        const [found] = await read(collection, where, { limit: 1 });
        if (!found) return null;

        const { id: _ignored, ...patch } = update as RecordInput;
        return (await collection.update(found.id, patch)) as never;
      },

      async updateMany({ model, where, update }) {
        const collection = tableOf(model);
        const found = await read(collection, where);
        const { id: _ignored, ...patch } = update;

        for (const record of found) await collection.update(record.id, patch);
        return found.length;
      },

      async delete({ model, where }) {
        const collection = tableOf(model);
        const [found] = await read(collection, where, { limit: 1 });
        if (found) await collection.delete(found.id);
      },

      async deleteMany({ model, where }) {
        const collection = tableOf(model);
        const found = await read(collection, where);

        for (const record of found) await collection.delete(record.id);
        return found.length;
      },
    }),
  });
}
