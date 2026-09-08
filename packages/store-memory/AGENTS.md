# @shuri/store-memory

In-memory implementation of `StoreAdapter` (`@shuri/store`) — useful for tests and for development
before a real database is wired up. State lives only in memory and is lost when the process restarts.

## Tree

```
src/
  index.ts                    re-exports memory-adapter.js
  memory-adapter.ts            createMemoryAdapter() and the in-memory query engine
  memory-adapter.test.ts       unit tests for the adapter
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
  filters still apply); this is what makes `@shuri/auth`'s per-request session lookup O(1)
  instead of O(sessions). Only `eq` uses the index — sorting and range filters still scan.
- **No table copy for the plain page** — a `findMany` with neither `where` nor `orderBy` pages
  straight off the table iterator (`page`), and `count` without `where` is arithmetic on
  `size`, so `GET /collections/x?limit=20` costs the page, not the table.

## Role in the monorepo

The `StoreAdapter` used by `@shuri/demo` and in `@shuri/api`/`@shuri/sdk` integration tests. `@shuri/store-mongo` is the
real-engine counterpart: same `StoreAdapter` contract, with the `Query` AST translated to native
MongoDB queries.
