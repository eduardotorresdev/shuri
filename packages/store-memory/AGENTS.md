# @shuri/store-memory

In-memory implementation of `StoreAdapter` (`@shuri/store`) — useful for tests and for development
before a real database is wired up. State lives only in memory and is lost when the process restarts.

## Tree

```
src/
  index.ts                    re-exports memory-adapter.js
  memory-adapter.ts            createMemoryAdapter() and the in-memory query engine
  memory-adapter.test.ts       unit tests for the adapter
  tables.ts                    MemoryState (tables + globals), tableFor with the schema-identity index memo, cloneTable
  tables.test.ts
  migrations.ts                createMemoryMigrations(): the @shuri/migrate MigrationDriver, copy-on-write
  migrations.test.ts
  test/migrations.test.ts      the driver contract (@shuri/migrate/testing) + migrations through the real adapter
```

## What each part does

- **memory-adapter.ts** — `createMemoryAdapter()` keeps each collection in a `Map<RecordId,
StoreRecord>` (one table per slug) and globals in a single `Map<slug, RecordInput>`. Implements the
  `@shuri/store` `Query` AST by hand: `matchesFilter`/`matchesWhere` filter, `sortRecords`/`compare`
  sort (compares `number`/`string`/`boolean`; mismatched types tie), `applyQuery` chains filter ->
  sort -> offset -> limit. `insert` generates the `id` via `randomUUID()`; `update` does a shallow
  merge and throws `RecordNotFoundError` if the id doesn't exist.
- **Indexes** — a field declared `index: true` gets a secondary index (`Map<value, Set<id>>`),
  kept in step by `insert`/`update`/`delete`. A `findMany`/`count` whose `where` has an `eq`
  filter on such a field starts from that value's records instead of the whole table (the other
  filters still apply); this is what makes `@shuri/better-auth`'s per-request session lookup O(1)
  instead of O(sessions). Only `eq` uses the index — sorting and range filters still scan.
- **tables.ts** — the state the adapter and the migration driver share (`createMemoryState()`).
  `tableFor(state, collection)` memoises a table's indexes by the **identity** of the
  `CollectionSchema` last seen: a new reference (a migration, a hot reload) rebuilds them from the
  rows, so the index never lags the schema; with a stable schema it is a lookup and a comparison.
- **migrations.ts** — `adapter.migrations`, the `MigrationDriver`: a **reference/debug driver**. Memory state
  resets on every boot, so production does not need it; it exists for the demo, for tests and as the
  reference implementation of the contract suite. `atomicity: "migration"`, copy-on-write: ops run on a
  draft that clones a table or a global only when an op first writes to it (untouched tables are shared
  with the live state, indexes included), the journal entry is written (`markApplied`) and only then is the
  draft swapped in, synchronously. A failure (a lost lock, checked with `assertHeld` before each op and
  before the journal, a failing journal, a `RenameCollisionError`) leaves data and journal untouched. A
  rename onto a collection that has rows, or onto an existing global, throws `RenameCollisionError`
  (`@shuri/migrate`). Lock and journal come from `createMemoryJournal()`. `onStep` on
  `createMemoryAdapter({ onStep })` is the seam the contract suite uses to inject a crash.
- **No table copy for the plain page** — a `findMany` with neither `where` nor `orderBy` pages
  straight off the table iterator (`page`), and `count` without `where` is arithmetic on
  `size`, so `GET /collections/x?limit=20` costs the page, not the table.

## Role in the monorepo

The `StoreAdapter` used by `@shuri/demo` and in `@shuri/api`/`@shuri/sdk` integration tests. `@shuri/store-mongo` is the
real-engine counterpart: same `StoreAdapter` contract, with the `Query` AST translated to native
MongoDB queries.
