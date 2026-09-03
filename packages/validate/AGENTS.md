# @shuri/validate

The monorepo's single source of validation: schema-based combinators (`object`, `array`, `arrayOf`,
`record`, `refine`, `required`, `oneOf`, `optional`, `all`, ...), composed in place of hand-rolled
`if`/`typeof` checks. Every other package that validates data with a schema shape composes from here;
a missing combinator gets added here (with a colocated unit test) and used from there.

## Tree

```
src/
  index.ts            re-exports types, errors and validators
  types.ts             Issue, ValidationContext, Validator<T>
  context.ts            createContext: builds the root ValidationContext and accumulates issues by path
  errors.ts              ValidationError (issues -> Error), formatIssue/formatIssues
  validators.ts           validate/assertValid + every combinator
  validators.test.ts       unit tests for each combinator
```

## What each part does

- **types.ts** — the central contract: `Validator<T> = (value, ctx) => void`; `ValidationContext`
  knows its own `path` and offers `addIssue`/`at(segment)` to descend one level (field/index/key).
- **context.ts** — `ValidationContext` implementation: each `at()` produces a child context with the
  path concatenated, all pushing into the same `issues` array.
- **errors.ts** — `ValidationError` is the exception thrown by `assertValid`/consumers; carries the
  original `issues` and formats a readable message.
- **validators.ts** — two runners (`validate` collects issues, `assertValid` throws) and the
  combinators:
  - primitives: `required`, `refine`, `optional`, `oneOf`, `all`
  - structural: `object` (fixed fields), `array`/`arrayOf` (by index), `record` (arbitrary keys),
    `keyedArray`/`unique` (dedupe by derived key), `nonEmpty`

## Role in the monorepo

Pure infrastructure, scoped to validation itself rather than collections/fields/records. `@shuri/core`
and `@shuri/api` compose validators from here to validate declared schema and records/queries
respectively.
