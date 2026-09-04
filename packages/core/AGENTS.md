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
    types.ts                    CollectionSchema (slug, title, singular, plural, orderable?, internal?, fields)
    fields.ts                    Field union (text/textarea/email/select/number/boolean/relation)
    schema.ts                    collectionsValidator: shape of the collections array
    validate.ts                  validateCollections: runs the validator, formats issues into string[]
    define.ts                    defineCollections, createCore/Core/CoreConfig — entry point
    validate-record.ts           recordValidator/validateRecord: validates a RECORD against fields
    redact.ts                    hiddenFieldNames/redactRecord(s)/servableCollections: what hidden/internal mean
    infer.ts                     InferFields/InferCollection/InferCollections (schema -> TS type)
    errors.ts                    CollectionSchemaError
    define.test.ts, validate.test.ts, validate-record.test.ts, redact.test.ts
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
  whole CMS (`text`, `textarea`, `email`, `select`, `number`, `boolean`, `relation`), plus `hidden?`
  on `FieldBase`.
- **`hidden` (a field) and `internal` (a collection)** — two flags this package declares, validates
  _and defines the meaning of_ (`redact.ts`), but never applies on its own. They are HTTP-surface
  metadata: `hidden` keeps a value out of REST responses, SSE frames and the OpenAPI document and
  makes it unwritable over HTTP; `internal` keeps a whole collection off HTTP, answering exactly as an
  undeclared slug would. Because they describe the surface and not the record, `InferFields`/
  `InferCollection` are unchanged: a `hidden` field is still in the inferred record shape and an
  `internal` collection is still in `InferCollections`, so both stay fully readable and writable
  through `@shuri/store`. `hidden` sits on `FieldBase`, so globals get it too, on purpose.
- **collections/redact.ts** — the pure projection every consumer of `hidden`/`internal` shares:
  `hiddenFieldNames`/`redactRecord`/`redactRecords` (memoized per schema, copy-never-mutate) and
  `servableCollections`. Lives here rather than in `@shuri/api` on purpose: these functions only need
  a `RecordSchema`/`CollectionSchema`, nothing about `Store` or HTTP, so any future consumer of this
  package gets the same definition of "what hidden/internal mean" for free instead of reinventing it.
  `@shuri/api`'s `visibility/` folder is where they are _enforced_ (the HTTP-shaped guards, errors and
  narrowed views) — it imports these functions rather than defining its own.
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
`createCore` as the first step of `create()`. `@shuri/api` depends on this package for real (not just
types): it calls `redact.ts`'s functions from its `visibility/` folder to enforce `hidden`/`internal`,
and reads `Core`/`CollectionSchema`/`GlobalSchema`/`Field` to build the OpenAPI document — leaving the
`createCore` call itself to `@shuri/sdk`. `@shuri/auth` declares its four collections as plain schema
literals of this package.
