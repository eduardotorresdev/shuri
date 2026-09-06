# @shuri/better-auth

Runs [better-auth](https://better-auth.com) on the app's **own** `@shuri/store` — one persistence
adapter, one set of migrations, one event bus — instead of the second database better-auth normally
brings. Optional: `@shuri/auth` is still there, and an app picks one.

What you gain over `@shuri/auth`: email verification, password reset, 2FA, passkeys, magic links,
rate limiting, a large set of social providers, and roles through better-auth's own `admin`/
`organization` plugins. What you give up: this is the one package in the repo with third-party
dependencies — better-auth pulls in `zod`, `jose`, `kysely`, `nanostores`, `@noble/*` and more.

## Tree

```
src/
  index.ts                   re-exports everything below
  collections.ts              betterAuthCollections: better-auth's schema -> Shuri collections
  handler.ts                   toFallingHandler: better-auth's handler -> a Shuri falling one
  session.ts                    toAuthSession/toSessionResolver: its session -> @shuri/auth's shape
  setup.ts                       createBetterAuthSetup: @shuri/ui's first-run source
  plugin.ts                      betterAuthPlugin: the one thing a host mounts
  test-support.ts                 recordingAdapter: watches which collection a write lands in
  adapter/
    factory.ts                 createShuriAdapter: the better-auth DB adapter, over @shuri/store
    where.ts                    isPushable/toStoreWhere/toStoreQuery: what the store can evaluate
    match.ts                     matchesWhere: what it can't, evaluated here
    sort.ts                       sortRecords: ordering for a read that was not pushed down
  test/
    integration.test.ts        signup/login/session through the app's own handler and adapter
    admin.test.ts               @shuri/ui's admin, guarded by better-auth, unchanged
    setup.test.ts                the first-run flow, including two attempts racing
```

## How it is mounted

```ts
import { create } from "@shuri/sdk";
import { betterAuthPlugin } from "@shuri/better-auth";
import { createAdminHandler } from "@shuri/ui";

const ba = betterAuthPlugin({
  options: { baseURL, secret, emailAndPassword: { enabled: true } },
});

const app = create({
  collections,
  globals,
  adapter,
  plugins: [
    ba,
    {
      name: "admin",
      handlers: () => [
        createAdminHandler(
          { collections, globals },
          {
            auth: {
              auth: ba.sessionSource,
              basePath: ba.basePath,
              signInPath: `${ba.basePath}/sign-in/email`,
              signOutPath: `${ba.basePath}/sign-out`,
              authorize: (session) => session.user["role"] === "admin",
            },
          },
        ),
      ],
    },
  ],
});
```

`plugins` rather than `handlers` because this contributes **collections**: they have to be in the
schema before the store is built, and the adapter needs that store once it is. Only `create()` can
close that circle, which is what `ShuriPlugin` exists for.

## What each part does

- **collections.ts** — calls better-auth's own `getSchema(options)` and maps each table onto a
  `CollectionSchema`. Derived, never hand-written: the set of tables is not fixed. Enabling the
  `admin` plugin adds `role` and `banned` to `user`, `organization` adds three whole tables, and a
  hand-maintained copy would be wrong the moment a host changed its plugins. Passing the _same_
  options here that go to `betterAuth()` keeps the two in step by construction. Every table is
  `internal: true`, and every secret-bearing column (`password`, `token`, `accessToken`,
  `refreshToken`, `idToken`, `value`) is `hidden` on top of that.
- **adapter/factory.ts** — the eight CRUD methods `createAdapterFactory` asks for, over
  `CollectionStore`. Three mismatches it works around:
  - **The store owns ids.** `insert` rejects a payload carrying one, so the adapter runs with
    `disableIdGeneration` and better-auth reads back the id the store assigned.
  - **Writes address a row by id; better-auth addresses it by filter.** So `update`/`delete` are a
    read followed by a write. See "Deliberately absent" for what that costs.
  - **`@shuri/core` has no date, JSON or array field.** `supportsDates`/`supportsJSON`/
    `supportsArrays` are all off, so better-auth serializes them and this stores text. An ISO-8601
    date still orders correctly as a string, which is what the session-expiry queries need.
- **adapter/where.ts** — the pushdown decision. `Query.where` is a `Record<field, FilterOp>`: a
  conjunction of exactly one operator per field. An `OR` connector, two clauses on one field,
  `not_in`/`starts_with`/`ends_with`, or case-insensitive matching all fall outside it. When any
  appears, **nothing** is pushed down — narrowing by a subset is wrong for an `OR`, and being wrong
  here returns too few rows rather than failing. `limit`/`offset` ride along only with a pushed-down
  filter, or the page would be cut from the wrong set.
- **adapter/match.ts** — evaluates what could not be pushed down, reproducing better-auth's own fold
  quirks included (it seeds with clause 0 and then folds over every clause again). Reproducing rather
  than tidying is what keeps an unpushable query answering the same as better-auth's own adapter.
- **handler.ts** — better-auth answers 404 off-route; Shuri's chain expects `undefined`. Without this
  wrapper, mounting better-auth would swallow the app: its 404 would be the final word on
  `/collections/posts`.
- **session.ts** — maps better-auth's session onto `@shuri/auth`'s `AuthSession`, the shape the rest
  of the repo already speaks. That mapping is the whole reason **`@shuri/ui`'s admin needs no change
  at all**: its guard takes an `AdminSessionSource`, and this satisfies it. `name` is pulled out of
  the user spread rather than written over it — better-auth stores an absent name as `null`, and
  every `user.name ?? user.email` fallback downstream would render that null.
- **setup.ts** — the first-run source for `@shuri/ui`. `required()` is "the user table is empty",
  which is the property that actually matters: true exactly once in an app's life, and false the
  instant an account exists by any route, so nothing has to remember that setup ran. `create()`
  forwards to better-auth's own signup rather than writing to the store, so the password goes through
  its hasher and the answer already carries the session cookie — whoever completes setup ends up
  signed in. `fields` stamps whatever `authorize` will read (`{ role: "admin" }`), and **the column
  must be one better-auth knows about**: it parses a user against its own schema on the way out, so
  an undeclared column is stored and then silently dropped before any session sees it.
- **plugin.ts** — `sessionSource` is handed out **before** `create()` runs and bound afterwards.
  Without that indirection the composition deadlocks: the admin's guard needs a session source, the
  session source needs the store, and the store is what `create()` is in the middle of building.

## Caveats that matter

- **No unique constraint.** better-auth's model marks `user.email` and `session.token` unique;
  `@shuri/store` has no such thing and cannot enforce it. better-auth checks for an existing user
  before signup, so the normal path is safe, but two concurrent signups with the same email can both
  land. A production adapter should add the constraint at the database level.
- **`update`/`delete` are two round trips and not atomic.** better-auth addresses a row by filter and
  the store by id, so each write reads first. A concurrent delete between the two is last-writer-wins.
- **`transaction` is off.** `@shuri/store` exposes none, so better-auth runs multi-step operations
  sequentially. A failure part-way leaves the earlier steps applied.
- **An unpushable query reads the whole collection.** In practice better-auth queries by `id`,
  `token`, `email` or `userId` — all pushable. The exotic operators show up in rate limiting and
  cleanup. Worth knowing before enabling a plugin that queries differently.
- **better-auth checks the `Origin` header** on state-changing requests and answers 403
  (`MISSING_OR_NULL_ORIGIN`) without one. A browser always sends it; a script or a `curl` probe must
  add it, or be listed in better-auth's `trustedOrigins`. `@shuri/auth` has no such check, so a
  non-browser client that worked against it needs one more header here.
- **Undeclared fields are stored but never validated.** `@shuri/core` validates the fields a schema
  declares and ignores the rest, so a better-auth plugin whose columns are missing from
  `betterAuthCollections` still works — it just gets no validation. Passing the same options to both
  is what keeps that from happening.

## Deliberately absent

- **Social sign-in from the admin's login screen.** `@shuri/ui` builds its provider buttons as links
  to `{basePath}/oidc/:id`, which is `@shuri/auth`'s shape; better-auth's social flow is a POST to
  `/sign-in/social` that answers with a URL to follow. The plugin advertises no providers, so the
  admin shows email and password only. Everything else about better-auth's social support works — it
  is the admin's button that has no equivalent yet.
- **A migration story.** `@shuri/store` has no migrations, so neither does this. Whatever the app's
  own `StoreAdapter` does about schema changes is what these four tables get.
- **Replacing `@shuri/auth`.** Both ship. An app picks one; mounting both would give it two session
  cookies and two user tables.

## Role in the monorepo

Depends on `better-auth`, `@shuri/store` (the adapter's target), `@shuri/api` (`FallingHandler`),
`@shuri/core` (the field types) and `@shuri/sdk` (`ShuriPlugin`), plus `@shuri/auth` for the
`AuthSession` type it maps onto — a type import only, never `createAuth`. Nothing depends on it.
`@shuri/ui` is a devDependency, used by `test/admin.test.ts` to prove the admin works against
better-auth with no change to `@shuri/ui` itself.
