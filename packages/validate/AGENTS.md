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
  collections.ts            arrayOf (with min) and record (with key validator): untrusted-shape collections
  collections.test.ts        unit tests for arrayOf/record
  discriminated.ts            tagged-union combinator
  discriminated.test.ts        unit tests for discriminated
  primitives.ts             type and length/pattern primitives (string, number, boolean, func, minLength, maxLength, matches)
  primitives.test.ts         unit tests for each primitive
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
  - primitives: `required`, `refine`, `optional`, `nullable` (accepts `null`, else delegates), `oneOf`, `all`
  - structural: `object`/`objectOf` (fixed fields), `array` (by index), `keyedArray`/`unique` (dedupe
    by derived key), `nonEmpty`
- **collections.ts** — the untrusted-shape collection combinators, split out of `validators.ts` to
  keep it under the 300-line ceiling: `arrayOf(item, message?, { min, minMessage })` (the array type
  check, then the minimum length at the array's own path, then each item) and
  `record(value, message?, { key })` (each entry's key is validated by `key` at `ctx.at(key)`, the
  same path its value is validated at).
- **discriminated.ts** — `discriminated(tag, variants, message?)` validates a tagged union: a
  non-object is reported at the current path (`must be an object`), an unknown or missing tag at the
  tag's own path (default `must be one of a, b`; inherited keys such as `toString` don't count), and
  otherwise the matching variant runs with the _same_ context, so its issue paths are unchanged.
  Added for `@shuri/migrate`'s op and field-spec validators.
- **primitives.ts** — the type guards (`string`, `number` — which also rejects `NaN` —, `boolean`,
  `func`) and
  the string checks (`minLength`, `maxLength`, `matches`), all over `unknown`. They live in their own
  file because `validators.ts` is already close to the 300-line ceiling. A length or pattern check
  leaves a non-string alone, so composing `all(string(), minLength(8))` reports one issue rather than
  two for the same cause; `matches` resets `lastIndex`, so a `/g` pattern can't alternate between
  calls. Added for `@shuri/core`'s `hidden`/`internal` flags and `@shuri/ui`'s setup and user bodies,
  all of which would otherwise be loose `typeof` checks.

## Role in the monorepo

Pure infrastructure, scoped to validation itself rather than collections/fields/records. `@shuri/core`
and `@shuri/api` compose validators from here to validate declared schema and records/queries
respectively.
