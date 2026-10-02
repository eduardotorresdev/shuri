# @shuri/core

Defines and validates the schema that describes the CMS — **collections** (record lists) and
**globals** (single records) — and infers the TS types of records from that schema. Persistence lives
in `@shuri/store` and HTTP serving in `@shuri/api`; this package is purely declarative. The one
runtime concern it owns is the _meaning_ of the schema's surface flags (`hidden`, `internal`,
`access`): pure functions other packages apply. Lifecycle `hooks` are declared and validated here
too, and run by `@shuri/store`.

## Tree

```
src/
  index.ts                    re-exports collections/ and globals/
  schema.ts                   ResolvedSchema: the merged, validated {collections, globals} tools like @shuri/migrate receive
  fields/
    validator.ts               fieldValidator/fieldsValidator: shape of a Field (shared)
    slug.ts                    slugValidator/fieldNameValidator: reserved `_` slug prefix and reserved `id` field name
    validator.test.ts, slug.test.ts
  collections/
    types.ts                    CollectionSchema (slug, title, singular, plural, orderable?, internal?, access?, hooks?, fields)
    fields.ts                    Field union (text/textarea/email/select/number/boolean/relation)
    schema.ts                    collectionsValidator: shape of the collections array
    validate.ts                  validateCollections: runs the validator, formats issues into string[]
    define.ts                    defineCollections, createCore/Core/CoreConfig — entry point
    validate-record.ts           recordValidator/validateRecord: validates a RECORD against fields
    redact.ts                    hiddenFieldNames/redactRecord(s)/servableCollections: what hidden/internal mean
    query.ts                     the Query AST (FilterOp, Where, OrderBy, Query) — re-exported by @shuri/store
    infer.ts                     InferFields/InferCollection/InferCollections (schema -> TS type)
    errors.ts                    CollectionSchemaError
    define.test.ts, validate.test.ts, validate-record.test.ts, redact.test.ts
    test/create-core.test.ts     integration test for createCore
  access/
    types.ts                    AccessContext/Principal/AccessRule/AccessResult, the op lists
    scopes.ts                    scopeFor/derivedScopes/expandScopes: the `<slug>:<op>` vocabulary
    policy.ts                    evaluateRule/authorize/authorizeCollection/authorizeGlobal: the policy table
    validator.ts                 accessValidator: shape of an `access` map (booleans or functions)
    errors.ts                    AccessRuleError (a Where where only a boolean makes sense)
    scopes.test.ts, policy.test.ts, validator.test.ts
  hooks/
    types.ts                    OperationContext, the hook arg/fn types per name, CollectionHooks/GlobalHooks
    validator.ts                 hooksValidator: shape of a `hooks` map (arrays of functions per known name)
    validator.test.ts
  globals/
    types.ts                    GlobalSchema (slug, title, category, access?, hooks?, fields), GlobalCategory
    schema.ts                    globalsValidator: shape of the globals array
    define.ts                    defineGlobals
    infer.ts                     InferGlobal/InferGlobals
    errors.ts                    GlobalSchemaError
    define.test.ts, schema.test.ts
```

## What each part does

- **fields/slug.ts** — two reserved names, enforced for collections and globals alike: a slug cannot
  start with `_` (that prefix belongs to Shuri's own storage, e.g. the `_globals` Mongo collection and
  the `_migrations` journal) and no field can be called `id` (every record already has one, and the
  Mongo adapter maps it to `_id`).
- **schema.ts** — `ResolvedSchema`, the `{collections, globals}` pair once plugins are merged and
  everything validated; the input of `@shuri/migrate`'s snapshot.
- **fields/validator.ts** — validates the shape of a single `Field`: `select` requires non-empty,
  non-duplicate options, `number` checks min/max/sign/kind coherence, `relation` must reference an
  existing collection slug. Used by both `collections/schema.ts` and `globals/schema.ts`.
- **collections/fields.ts** — the `Field` union and its subtypes; the field-type vocabulary of the
  whole CMS (`text`, `textarea`, `email`, `select`, `number`, `boolean`, `relation`), plus `hidden?`
  and `index?` on `FieldBase`.
- **`index` (a field)** — a hint to the adapter: index this field for equality lookups
  (`where: { field: { op: "eq" } }`). Without it a lookup by value is a scan of the whole
  collection in every adapter (the memory adapter copies and filters the table, Mongo walks the
  collection). Declare it on any field a hot path looks up per request — a session token, an
  email.
  Validated as a boolean, applied by `@shuri/store-memory` (a secondary `Map`) and
  `@shuri/store-mongo` (`createIndex` on first touch); not a uniqueness constraint.
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
- **`access` (a collection or a global)** — the third surface flag, next to `hidden`/`internal`,
  declared here and applied by `@shuri/api`'s `access/` folder once the host turns auth on. Per
  operation (`create`/`list`/`view`/`update`/`delete` for a collection, `read`/`update` for a
  global) a rule is `boolean` or `(ctx) => boolean | Where | Promise<...>`, Payload CMS style: `ctx`
  carries the `principal` (with `user`/`client` shortcuts), the `request`, and the `id`/`data` of the
  operation. `access/policy.ts` is the whole policy in one function: no rule means "any signed-in
  principal, never anonymous"; a rule decides for users and anonymous alike; a **client** (a
  client-credentials token) must hold the scope `<slug>:<op>` _and_ pass the rule — its scopes are a
  ceiling the rule can only lower, so a public rule never spares a client its scope. A `Where` is a
  row restriction, meaningful only for `list`/`view`/`update`/`delete`; a rule answering with one for
  `create` or for a global throws `AccessRuleError` (fail closed, and loudly). Scopes are not
  declared anywhere: `derivedScopes` computes the universe from the schema (`internal` collections
  yield none), and `expandScopes` turns role patterns (`*`, `posts:*`, `*:list`, literal) into it at
  token issuance. Like `redact.ts`, this folder _defines_; enforcement is elsewhere.
- **`hooks` (a collection or a global)** — Payload CMS's lifecycle vocabulary, declared here and run
  by `@shuri/store` around every operation, whichever surface it came through (SDK, REST, or a
  future admin). A collection takes `beforeValidate`, `beforeChange`, `afterChange`, `beforeRead`,
  `afterRead`, `beforeDelete` and `afterDelete`; a global the same set minus the delete pair. Each is
  an **array** of functions run in declaration order, and a schema-declared hook runs before one
  registered at runtime (`app.hooks.onCollection(slug, name, fn)`, which is the PocketBase side of
  the same idea). The _before_ hooks of a write (`beforeValidate` before field validation,
  `beforeChange` after it) may return a replacement `data`; `beforeRead` may return a replacement
  `query` for a list; `afterRead` runs once per record returned and may replace the `doc`; the
  _after_ hooks of a write receive the persisted `doc` (plus `previousDoc` on update) and return
  nothing. Every hook gets an `OperationContext`: `@shuri/api` fills in the `request` and, with
  access on, the `principal`, so a hook can react to who did what; a call through the SDK carries an
  empty one. Hook args are typed over `HookRecord` (`Record<string, unknown>`) in the schema, since a
  literal can't reference its own `fields`; the SDK's `app.hooks` narrows them per slug. Like
  `access`, `hooks/validator.ts` validates the _shape_ (known names, arrays of functions); what a
  hook does is only known when it runs.
- **collections/query.ts** — the `Query` AST every adapter receives, moved here from `@shuri/store`
  (which re-exports it, so nothing imports it differently) because an access rule answers with a
  `Where` and this package can't depend on the store. `Where` allows `FilterOp | FilterOp[]` per
  field — the array ANDs — so a client's `where` and a rule's `Where` merge without either winning.
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
  record (`InferCollection<C>`, `InferGlobal<G>`), with no manual types needed anywhere. A `select`
  with `multiple: true` infers (and validates) as a list of its options, like a multiple `relation`.
- **errors.ts** (in both) — `CollectionSchemaError`/`GlobalSchemaError`, thrown by `define*` to
  report a malformed _schema_; `RecordValidationError` (in `@shuri/store`) reports the other case, a
  _record_ that conflicts with an already-valid schema.

## Role in the monorepo

`@shuri/store` uses `validateRecord`/`RecordSchema` to guard `insert`/`update`. `@shuri/sdk` uses
`createCore` as the first step of `create()`. `@shuri/api` depends on this package for real (not just
types): it calls `redact.ts`'s functions from its `visibility/` folder to enforce `hidden`/`internal`,
reads `Core`/`CollectionSchema`/`GlobalSchema`/`Field` to build the OpenAPI document, and calls
`access/policy.ts` from its `access/` folder — leaving the `createCore` call itself to `@shuri/sdk`.
`@shuri/better-auth` derives better-auth's tables as plain schema literals of this package.
`@shuri/store` runs the `hooks` declared here. `@shuri/ui` calls
`redact.ts`'s `servableCollections`/`visibleFields` to build the document its admin generates every
screen from, so the admin shows exactly the collections and fields the HTTP surface does. `tsconfig`
pulls in `@types/node` only for the `Request` type on `AccessContext`.
