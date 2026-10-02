# @shuri/store-mongo

MongoDB implementation of `StoreAdapter` (`@shuri/store`), on top of the official `mongodb` driver.
The caller connects a `MongoClient` and hands the adapter a `Db`; the adapter never opens or closes
connections itself.

## Tree

```
src/
  index.ts                    re-exports document.js, mongo-adapter.js and query.js
  mongo-adapter.ts             createMongoAdapter({ db, globalsCollection? })
  document.ts                  StoredDocument and the record <-> document mapping (toRecord, fieldsOf, bodyOf, pathOf)
  query.ts                     toMongoWhere/toMongoSort/toMongoFilter: the Query AST -> Mongo translation
  query.test.ts                unit tests for the translation (no database)
  test/
    mongo-adapter.test.ts      integration test against a real mongod
```

## What each part does

- **document.ts** — the one place that knows how a record is laid out in a document: `pathOf`
  (`id` -> `_id`), `toRecord` (document -> `StoreRecord`), `fieldsOf` (document minus `_id`, for
  globals) and `bodyOf` (payload minus `id`, so a caller can never write an id into the body).
- **query.ts** — translates the `@shuri/store` `Query` AST into native Mongo. `toMongoWhere` turns
  a `Where` into `{ $and: [{ field: { $op } }, ...] }` — one clause per filter, so several filters
  on the same field (the array form) are all kept. `eq`/`ne`/`gt`/`gte`/`lt`/`lte`/`in` map 1:1 to
  `$eq`/`$ne`/...; `contains` becomes an escaped `$regex`, so the value is matched as a literal
  substring. The `id` field is mapped to `_id` in both filters and sorts. `toMongoSort` keeps the
  `orderBy` field order (`asc` = 1, `desc` = -1).
- **mongo-adapter.ts** — `createMongoAdapter({ db, globalsCollection = "_globals" })`. Each
  `CollectionSchema` maps to the Mongo collection with the same `slug`. Record ids are UUID strings
  generated on `insert` and stored as `_id`; documents are converted back to `StoreRecord` (`_id`
  -> `id`) on the way out. A caller-provided `id` in a payload is dropped, never written into the
  document body. `update` is a `$set` (shallow merge) via `findOneAndUpdate` and throws
  `RecordNotFoundError` when the id doesn't exist. Requires **MongoDB 5.0+**, where an empty `$set`
  is a no-op, so an empty payload needs no special case. `count` honours `where`, `offset` and
  `limit`, like the memory adapter. `limit: 0` means "nothing" in the AST but "no limit" in Mongo,
  so `findMany`/`count` short-circuit it. Fields declared `index: true` get a Mongo index
  (`createIndex({ field: 1 })`) the first time an operation touches their collection, once per
  adapter instance (`indexed`, a memoized promise per slug; a failure forgets the attempt so the
  next operation retries). Idempotent on the server, so a restart is one round trip per
  collection.
  `delete` is a no-op for an unknown id. Globals all live in one collection (`globalsCollection`),
  one document per slug with `_id = slug`; `updateGlobal` upserts with `$set`.

## Migrations

None, on purpose. The adapter exposes no `migrations` driver and does not depend on `@shuri/migrate`: MongoDB is
schemaless, so adding or dropping fields needs no migration, and renames and type changes are handled manually
for now (a driver was built and then removed). Migrations
are optional per adapter, so this is a valid adapter.

## Testing

`query.test.ts` needs no database. `test/mongo-adapter.test.ts` needs a real `mongod`: it uses
`MONGO_URL` when set (e.g. a docker container in CI) and otherwise starts a throwaway
`mongodb-memory-server`, which downloads a MongoDB binary to `~/.cache/mongodb-binaries` the first
time it runs (slow once, cached afterwards).

## Role in the monorepo

A production `StoreAdapter`, interchangeable with `@shuri/store-memory`: `@shuri/sdk`'s `create()`
takes either one as `adapter`. Only `@shuri/store`'s contract and error types are shared; nothing
else in the monorepo depends on `mongodb`.
