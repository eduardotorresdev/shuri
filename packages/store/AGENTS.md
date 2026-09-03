# @shuri/store

Engine-agnostic persistence layer. Defines the `StoreAdapter` port (implemented once per database —
in-memory, sqlite, postgres, ...) and the `Store`/`CollectionStore`/`GlobalStore`, which expose
per-slug typed CRUD operations and validate every record against `@shuri/core`'s `fields` **before**
it reaches the adapter.

## Tree

```
src/
  index.ts                    re-exports everything below
  record.ts                    RecordId, RecordInput, StoreRecord (= record + id)
  adapter.ts                   StoreAdapter — the port implemented per engine
  store.ts                     createStore/Store — ties a Core to a StoreAdapter
  errors.ts                    RecordValidationError
  validate-record.ts           assertValidRecord: guards insert/update, throws before the adapter
  store.test.ts                integration test for createStore
  collections/
    store.ts                    CollectionStore, bindCollection — CRUD for one collection
    query.ts                    engine-agnostic Query AST (Where, FilterOp, OrderBy)
    errors.ts                    RecordNotFoundError, UnknownCollectionError
    store.test.ts
  globals/
    store.ts                    GlobalStore, bindGlobal — get/update for one global
    errors.ts                    UnknownGlobalError
    store.test.ts
```

## What each part does

- **adapter.ts** — `StoreAdapter`: `findMany`/`findOne`/`count`/`insert`/`update`/`delete` (receive
  the whole `CollectionSchema`, giving an adapter enough context to translate the `Query` AST into
  its own native query language) + `findGlobal`/`updateGlobal`. The only contract a new engine needs
  to fulfill.
- **record.ts** — record vocabulary: `RecordInput` (payload without id), `StoreRecord` (with id).
- **store.ts** — `createStore(core, adapter)` resolves, on demand and cached, one `CollectionStore`
  per declared collection slug and one `GlobalStore` per declared global slug on the `Core`.
- **validate-record.ts** — `assertValidRecord` calls `validateRecord` from `@shuri/core` and throws
  `RecordValidationError` if there are issues; it's the guard run inside every `insert`/`update`.
- **collections/store.ts** — `CollectionStore`: `findMany`, `findOne`, `get` (throws
  `RecordNotFoundError` when `findOne` would return `undefined`), `count`, `insert`, `update`
  (partial), `delete`.
- **collections/query.ts** — the filter/sort/pagination AST (`FilterOp`: eq/ne/gt/gte/lt/lte/in/
  contains) every adapter receives and translates into its own native query language.
- **globals/store.ts** — `GlobalStore`: only `get`/`update`; `get()` always resolves, to `{}` before
  the first `update`.

## Role in the monorepo

`@shuri/store-memory` implements `StoreAdapter`. `@shuri/api` depends solely on this package to stay
framework-agnostic, using `CollectionStore`/`GlobalStore` as the only types it needs and leaving
`@shuri/core`/`@shuri/sdk` out of the picture. `@shuri/sdk` is the one that actually calls
`createStore`.
