# @shuri/store

Engine-agnostic persistence layer. Defines the `StoreAdapter` port (implemented once per database —
in-memory, sqlite, postgres, ...) and the `Store`/`CollectionStore`/`GlobalStore`, which expose
per-slug typed CRUD operations, validate every record against `@shuri/core`'s `fields` **before**
it reaches the adapter, and run the lifecycle **hooks** `@shuri/core` declares around every
operation — the ones on the schema, then the ones registered on `store.hooks`.

## Tree

```
src/
  index.ts                    re-exports everything below
  record.ts                    RecordId, RecordInput, StoreRecord (= record + id)
  adapter.ts                   StoreAdapter — the port implemented per engine
  store.ts                     createStore/Store — ties a Core to a StoreAdapter, owns the hook registry
  errors.ts                    RecordValidationError
  validate-record.ts           assertValidRecord: guards insert/update, throws before the adapter
  test-support.ts              createFakeAdapter, shared by this package's store tests
  store.test.ts                integration test for createStore
  hooks/
    registry.ts                 HookRegistry, createHookRegistry — onCollection/onGlobal(slug | "*", name, hook)
    run.ts                      runBeforeHooks (a return value replaces one arg) / runAfterHooks (void)
    resolve.ts                  collectionHooksFor/globalHooksFor: schema-declared first, then registered
    registry.test.ts, run.test.ts
  collections/
    store.ts                    CollectionStore, bindCollection — CRUD for one collection, hooks around each op
    query.ts                    re-exports the Query AST (Where, FilterOp, OrderBy) from @shuri/core
    match.ts                     matchesFilter/matchesWhere/mergeWhere/compareValues: the AST's in-memory semantics
    errors.ts                    RecordNotFoundError, UnknownCollectionError
    store.test.ts, store.hooks.test.ts, match.test.ts
  globals/
    store.ts                    GlobalStore, bindGlobal — get/update for one global, hooks around each
    errors.ts                    UnknownGlobalError
    store.test.ts
```

## What each part does

- **adapter.ts** — `StoreAdapter`: `findMany`/`findOne`/`count`/`insert`/`update`/`delete` (receive
  the whole `CollectionSchema`, giving an adapter enough context to translate the `Query` AST into
  its own native query language) + `findGlobal`/`updateGlobal`. The only contract a new engine needs
  to fulfill. Adapters know nothing about hooks: they run one layer up.
- **record.ts** — record vocabulary: `RecordInput` (payload without id), `StoreRecord` (with id).
- **store.ts** — `createStore(core, adapter)` resolves, on demand and cached, one `CollectionStore`
  per declared collection slug and one `GlobalStore` per declared global slug on the `Core`, and owns
  the single `store.hooks` registry they all consult.
- **hooks/registry.ts** — the PocketBase side of hooks: `onCollection(slug | "*", name, hook)` /
  `onGlobal(...)` register a hook at runtime and return its unsubscribe. `"*"` is for cross-cutting
  listeners (`@shuri/api`'s SSE feed, an audit log): a lookup returns the slug's own hooks first,
  then the wildcard ones, each in registration order, as a snapshot — so a hook unsubscribing while a
  chain runs can't make the runner skip the next one.
- **hooks/run.ts** — the two runners. `runBeforeHooks(hooks, args, key)` awaits each hook in turn;
  a returned value replaces `args[key]` (`data` for a write, `query` for a list, `doc` for a read)
  for the hooks after it and for the operation, `undefined` keeps the current one, and a throw aborts
  the chain **before the adapter is touched**. `runAfterHooks(hooks, args)` is the same loop for hooks
  with nothing to replace; a throw there propagates to the caller — for an _after_ hook the write
  already happened, so a consumer that must never fail the write (the SSE feed) catches its own.
- **hooks/resolve.ts** — the order of precedence in one place: schema-declared hooks (Payload style)
  run before registered ones, resolved per call so a hook registered after `createStore` still runs.
- **validate-record.ts** — `assertValidRecord` calls `validateRecord` from `@shuri/core` and throws
  `RecordValidationError` if there are issues; it's the guard run inside every `insert`/`update`,
  between `beforeValidate` and `beforeChange`.
- **The store is the complete view.** `CollectionStore`/`GlobalStore` each carry the `schema` they
  were bound to — `hidden` fields and `internal` collections included — and **never apply either
  flag**: both are HTTP-surface metadata, applied by `@shuri/api`'s `visibility/` folder. A hidden
  field is readable and writable from here, and an internal collection behaves like any other. The
  `schema` property exists so the HTTP layer can read that metadata off the very store it was handed,
  instead of being passed a `Core` or a precomputed map it could be built without. It is **mandatory,
  not optional**, for the same reason: an optional property fails open, and failing open here means
  serving a password hash with no error at all.
- **collections/store.ts** — `CollectionStore`: `schema`, `findMany`, `findOne`, `get` (throws
  `RecordNotFoundError` when `findOne` would return `undefined`), `count`, `insert`, `update`
  (partial), `delete`. Every method but `count` takes an optional trailing `context`
  (`OperationContext` from `@shuri/core`) that hooks see as-is: `@shuri/api` passes the `request` and,
  with access on, the `principal`; a direct call passes nothing. The sequences, per method:
  `findMany` — `beforeRead(list)` (may replace the query) → adapter → `afterRead` per record;
  `findOne`/`get` — `beforeRead(get)` → adapter → `afterRead` (skipped when nothing was found);
  `insert` — `beforeValidate` → field validation → `beforeChange` → adapter → `afterChange(create)`;
  `update` — reads the pre-image (throwing `RecordNotFoundError` when absent) → `beforeValidate` →
  partial validation → `beforeChange` (`originalDoc`) → adapter → `afterChange(update, previousDoc)`;
  `delete` — reads the pre-image (may be `undefined`) → `beforeDelete` → adapter → `afterDelete`.
  A delete of an unknown id is still accepted, as the adapter accepts it: the hooks then run with
  `doc` undefined, meaning "a delete was accepted", not "a record stopped existing". Every hook has
  run by the time the caller's `await` resolves.
- **collections/query.ts** — the filter/sort/pagination AST (`FilterOp`: eq/ne/gt/gte/lt/lte/in/
  contains) every adapter receives and translates into its own native query language. The types
  live in `@shuri/core` (an access rule answers with a `Where`, and core can't import this package)
  and are re-exported here unchanged. A `Where` field takes one filter or a list of them, ANDed.
- **collections/match.ts** — the reference, in-memory semantics of that AST: `matchesWhere(record,
where)` (strict `===` for `eq`/`ne`, `compareValues` for the ranges) and `mergeWhere(a, b)`, which
  ANDs two `Where`s field by field so neither can override the other. Hoisted out of
  `@shuri/store-memory` because `@shuri/api` needs the very same answer to check an access rule's
  `Where` against one record — two copies would drift.
- **globals/store.ts** — `GlobalStore`: `schema`, `get` (`beforeRead` → adapter → `afterRead`;
  always resolves, to `{}` before the first `update`) and `update` (pre-image via `findGlobal` →
  `beforeValidate` → partial validation → `beforeChange` → adapter → `afterChange` with
  `previousDoc`), same `context` param as the collection store.

## Role in the monorepo

`@shuri/store-memory` (in-memory) and `@shuri/store-mongo` (MongoDB) implement `StoreAdapter`. Migrations are
optional per adapter: an adapter may also expose `migrations` (`Migratable` of `@shuri/migrate`; only
`store-memory` does), and one without it is just as valid.
`@shuri/api` depends solely on this package to stay framework-agnostic, using
`CollectionStore`/`GlobalStore` as the only types it needs, and feeds its `/events` stream from
wildcard `afterChange`/`afterDelete` hooks on `store.hooks`. `@shuri/sdk` is the one that actually
calls `createStore`, and exposes `store.hooks` as the typed `app.hooks`. There is no in-process event
bus anymore: a consumer wanting to _react_ to a write registers a hook; one wanting to _observe_
from outside the process subscribes to the stream through `@shuri/client`.
