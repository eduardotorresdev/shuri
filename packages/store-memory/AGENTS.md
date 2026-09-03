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

## Role in the monorepo

The `StoreAdapter` used by `@shuri/demo` and in `@shuri/api`/`@shuri/sdk` integration tests. A real
engine (sqlite, postgres, ...) would follow the same `StoreAdapter` contract, swapping the in-memory
implementation for native queries.
