# @shuri/store

Engine-agnostic persistence layer. Defines the `StoreAdapter` port (implemented once per database —
in-memory, sqlite, postgres, ...) and the `Store`/`CollectionStore`/`GlobalStore`, which expose
per-slug typed CRUD operations and validate every record against `@shuri/core`'s `fields` **before**
it reaches the adapter. Every accepted write is published to the store's event bus, which is what
`subscribe` and `@shuri/api`'s SSE route both read.

## Tree

```
src/
  index.ts                    re-exports everything below
  record.ts                    RecordId, RecordInput, StoreRecord (= record + id)
  adapter.ts                   StoreAdapter — the port implemented per engine
  store.ts                     createStore/Store — ties a Core to a StoreAdapter, owns the event bus
  errors.ts                    RecordValidationError
  validate-record.ts           assertValidRecord: guards insert/update, throws before the adapter
  test-support.ts              createFakeAdapter, shared by this package's store tests
  store.test.ts                integration test for createStore
  events/
    types.ts                    StoreEvent union (scope + type), listener/unsubscribe types
    bus.ts                      StoreEventBus, createEventBus — publish/subscribe hub
    bus.test.ts
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
  per declared collection slug and one `GlobalStore` per declared global slug on the `Core`, and owns
  the single `store.events` bus they all publish to.
- **events/types.ts** — the event union, discriminated twice: `scope` ("collection"/"global") for
  dispatch, `type` ("create"/"update"/"delete") for consumers. A delete event carries only the id, so
  reading `event.record` requires narrowing by `type` first.
- **events/bus.ts** — `createEventBus()`: delivers synchronously to a snapshot of the listeners (so a
  listener unsubscribing mid-dispatch can't make the next one be skipped), and a listener that throws
  never fails the write — the error is rethrown in a microtask instead.
- **validate-record.ts** — `assertValidRecord` calls `validateRecord` from `@shuri/core` and throws
  `RecordValidationError` if there are issues; it's the guard run inside every `insert`/`update`.
- **collections/store.ts** — `CollectionStore`: `findMany`, `findOne`, `get` (throws
  `RecordNotFoundError` when `findOne` would return `undefined`), `count`, `insert`, `update`
  (partial), `delete`, plus `subscribe(listener)` (the whole collection) and `subscribe(id, listener)`
  (updates/deletes of one record; never a create). Every write emits **after** the adapter resolves
  and **before** the caller's `await` does: a write that throws emits nothing, and delivery is
  synchronous with the write. `delete` emits unconditionally, even for an id that never existed —
  the event means "a delete was accepted", not "a record stopped existing", and carries no pre-image.
- **collections/query.ts** — the filter/sort/pagination AST (`FilterOp`: eq/ne/gt/gte/lt/lte/in/
  contains) every adapter receives and translates into its own native query language.
- **globals/store.ts** — `GlobalStore`: `get`/`update` plus `subscribe(listener)` for this global's
  updates; `get()` always resolves, to `{}` before the first `update`. `update` emits under the same
  rule as the collection writes above.

## Role in the monorepo

`@shuri/store-memory` implements `StoreAdapter`. `@shuri/api` depends solely on this package to stay
framework-agnostic, using `CollectionStore`/`GlobalStore` as the only types it needs and leaving
`@shuri/core`/`@shuri/sdk` out of the picture. `@shuri/sdk` is the one that actually calls
`createStore`.
