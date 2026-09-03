# @shuri/core

Defines and validates the schema that describes the CMS — **collections** (record lists) and
**globals** (single records) — and infers the TS types of records from that schema. Persistence lives
in `@shuri/store` and HTTP serving in `@shuri/api`; this package is purely declarative.

## Tree

```
src/
  index.ts                    re-exports collections/ and globals/
  fields/
    validator.ts               fieldValidator/fieldsValidator: shape of a Field (shared)
    validator.test.ts
  collections/
    types.ts                    CollectionSchema (slug, title, singular, plural, orderable?, fields)
    fields.ts                    Field union (text/textarea/email/select/number/boolean/relation)
    schema.ts                    collectionsValidator: shape of the collections array
    validate.ts                  validateCollections: runs the validator, formats issues into string[]
    define.ts                    defineCollections, createCore/Core/CoreConfig — entry point
    validate-record.ts           recordValidator/validateRecord: validates a RECORD against fields
    infer.ts                     InferFields/InferCollection/InferCollections (schema -> TS type)
    errors.ts                    CollectionSchemaError
    define.test.ts, validate.test.ts, validate-record.test.ts
    test/create-core.test.ts     integration test for createCore
  globals/
    types.ts                    GlobalSchema (slug, title, category, fields), GlobalCategory
    schema.ts                    globalsValidator: shape of the globals array
    define.ts                    defineGlobals
    infer.ts                     InferGlobal/InferGlobals
    errors.ts                    GlobalSchemaError
    define.test.ts, schema.test.ts
```

## What each part does

- **fields/validator.ts** — validates the shape of a single `Field`: `select` requires non-empty,
  non-duplicate options, `number` checks min/max/sign/kind coherence, `relation` must reference an
  existing collection slug. Used by both `collections/schema.ts` and `globals/schema.ts`.
- **collections/fields.ts** — the `Field` union and its subtypes; the field-type vocabulary of the
  whole CMS (`text`, `textarea`, `email`, `select`, `number`, `boolean`, `relation`).
- **collections/schema.ts** / **globals/schema.ts** — validate the _shape of the declared schema
  itself_ (unique slugs, required schema fields, well-formed fields); records are validated
  separately, by `collections/validate-record.ts`.
- **collections/validate-record.ts** — the other side: validates a **record** (`{title: "..."}`)
  against the already-declared, already-valid `fields` of a schema; supports `{ partial: true }` for
  updates (PATCH). `RecordSchema` (`{slug, fields}`) is the structural shape shared by
  `CollectionSchema` and `GlobalSchema`, so this validation serves both.
- **collections/define.ts** — `defineCollections` validates and returns the array; `createCore` is
  the package's entry point: validates collections, then globals (which may reference collection
  slugs via `relation`), and returns a `Core` with typed `getCollection(slug)`/`getGlobal(slug)`.
- **collections/infer.ts** / **globals/infer.ts** — map declared `fields` to the TS shape of the
  record (`InferCollection<C>`, `InferGlobal<G>`), with no manual types needed anywhere.
- **errors.ts** (in both) — `CollectionSchemaError`/`GlobalSchemaError`, thrown by `define*` to
  report a malformed _schema_; `RecordValidationError` (in `@shuri/store`) reports the other case, a
  _record_ that conflicts with an already-valid schema.

## Role in the monorepo

`@shuri/store` uses `validateRecord`/`RecordSchema` to guard `insert`/`update`. `@shuri/sdk` uses
`createCore` as the first step of `create()`. `@shuri/api` uses `Core`/`CollectionSchema`/
`GlobalSchema`/`Field` purely as types (to build OpenAPI), leaving the `createCore` call itself to
`@shuri/sdk`.
