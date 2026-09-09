# @shuri/better-auth

Runs [better-auth](https://better-auth.com) on the app's **own** `@shuri/store` — one persistence
adapter, one set of migrations, one event bus — instead of the second database better-auth normally
brings. The toolkit's authentication: it mounts better-auth's routes, resolves the principal
`@shuri/api`'s access control decides on, and backs `@shuri/ui`'s login, first-run and Users
screens.

What better-auth brings: email verification, password reset, 2FA, passkeys, magic links, rate
limiting, a large set of social providers, and roles through its own `admin`/`organization` plugins.
What it costs: this is the one package in the repo with third-party dependencies — better-auth pulls
in `zod`, `jose`, `kysely`, `nanostores`, `@noble/*` and more.

## Tree

```
src/
  index.ts                   re-exports everything below
  collections.ts              betterAuthCollections: better-auth's schema -> Shuri collections
  handler.ts                   toFallingHandler: better-auth's handler -> a Shuri falling one
  session.ts                    toAdminSession/toSessionResolver: its session -> @shuri/ui's AdminSession
  principal.ts                   toPrincipalResolver: its session -> @shuri/api's Principal
  openapi.ts                      sessionCookieName/betterAuthOpenApiSecurity: the cookie scheme /openapi.json describes
  users.ts                         createBetterAuthUsers: @shuri/ui's UserAdminApi over the store + better-auth's internal adapter
  errors.ts                         UserNotFoundError (404), EmailAlreadyRegisteredError (409)
  setup.ts                           createBetterAuthSetup: @shuri/ui's first-run source
  plugin.ts                           betterAuthPlugin: the one thing a host mounts
  test-support.ts                      recordingAdapter: watches which collection a write lands in
  adapter/
    factory.ts                 createShuriAdapter: the better-auth DB adapter, over @shuri/store
    where.ts                    isPushable/toStoreWhere/toStoreQuery: what the store can evaluate
    match.ts                     matchesWhere: what it can't, evaluated here
    sort.ts                       sortRecords: ordering for a read that was not pushed down
  test/
    integration.test.ts        signup/login/session through the app's own handler and adapter
    access.test.ts              @shuri/api's access rules over real sessions; the OpenAPI security block
    admin.test.ts               @shuri/ui's admin, guarded by better-auth
    users.test.ts               user administration: create/list/rename/password/remove, verified through sign-in
    setup.test.ts               the first-run flow, including two attempts racing
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
close that circle, which is what `ShuriPlugin` exists for. The plugin also declares the
**principal** — which is what turns every `access` rule on: an op with no rule then needs a
signed-in user, exactly as `@shuri/api`'s policy says — and the **openapi** security block, so
`/openapi.json` names the session cookie on every guarded operation.

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
- **session.ts** — maps better-auth's session onto `@shuri/ui`'s `AdminSession`, the shape the
  admin's guard speaks (`AdminSessionSource`). `name` is pulled out of the user spread rather than
  written over it — better-auth stores an absent name as `null`, and every `user.name ?? user.email`
  fallback downstream would render that null.
- **principal.ts** — the same session as `@shuri/api`'s `Principal`: `{ kind: "user", user }` or
  `ANONYMOUS`. Never throws — an expired or forged cookie is anonymous, exactly like no cookie;
  whether anonymous is enough is the policy's call. A user carries no scopes: like Payload CMS, any
  signed-in user may do anything a rule doesn't forbid, and the rule sees `ctx.user` (`role`
  included, when better-auth's `admin` plugin or `additionalFields` declares one).
- **openapi.ts** — the `cookieAuth` scheme `/openapi.json` stamps on every guarded operation. The
  cookie name is computed from the options (`advanced.cookiePrefix`, `advanced.cookies`, and
  better-auth's own `__Secure-` rule) rather than read off the built instance, because the document
  is assembled synchronously inside `create()` while better-auth's context is a promise.
- **users.ts** — `@shuri/ui`'s `UserAdminApi`, carried on `sessionSource.users` so handing the
  session source to the admin is all it takes to get the Users screens. Reads go through the app's
  own store (the user table is a Shuri collection, so `list` speaks the same `Query` every list
  does); writes go through better-auth's internal adapter, so a password is hashed by better-auth's
  hasher and lands on the `account` row its sign-in reads, and a new user runs whatever `user` hooks
  the host configured. Setting a password revokes every session the user holds; removing a user
  takes sessions, then accounts, then the row. A duplicate address is refused up front
  (`EmailAlreadyRegisteredError`): the adapters don't all enforce uniqueness, and a duplicate makes
  sign-in ambiguous for both accounts.
- **setup.ts** — the first-run source for `@shuri/ui`. `required()` is "the user table is empty",
  which is the property that actually matters: true exactly once in an app's life, and false the
  instant an account exists by any route, so nothing has to remember that setup ran. `create()`
  forwards to better-auth's own signup rather than writing to the store, so the password goes through
  its hasher and the answer already carries the session cookie — whoever completes setup ends up
  signed in. `fields` stamps whatever `authorize` will read (`{ role: "admin" }`), and **the column
  must be one better-auth knows about**: it parses a user against its own schema on the way out, so
  an undeclared column is stored and then silently dropped before any session sees it.
- **plugin.ts** — `sessionSource`, `setupSource`, `principal` and `instance()` are handed out
  **before** `create()` runs and bound afterwards. Without that indirection the composition
  deadlocks: the admin's guard needs a session source, the session source needs the store, and the
  store is what `create()` is in the middle of building.

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
  (`MISSING_OR_NULL_ORIGIN`) without one, once a cookie rides along. A browser always sends it; a
  `curl` probe must add it (`-H 'origin: …'`). `@shuri/client` names the server from its `baseUrl`,
  which is trusted by construction. **Under `NODE_ENV=test` better-auth skips this check** unless
  `advanced.disableOriginCheck: false` says otherwise — a test that passes without an `Origin` proves
  nothing about a real boot.
- **Undeclared fields are stored but never validated.** `@shuri/core` validates the fields a schema
  declares and ignores the rest, so a better-auth plugin whose columns are missing from
  `betterAuthCollections` still works — it just gets no validation. Passing the same options to both
  is what keeps that from happening.

## Deliberately absent

- **Advertised social providers.** The admin's login screen posts to `/sign-in/social` for every
  id in `AdminAuthOptions.providers`, but this plugin does not derive that list from better-auth's
  `socialProviders`; a host lists the ones it wants on the login screen.
- **Machine-to-machine tokens.** A client-credentials grant with schema-derived scopes is not
  something better-auth ships; its `apiKey`/`bearer` plugins are the nearest things, and
  `@shuri/core`'s `Principal` keeps its `client` kind for a plugin that provides one.
- **A migration story.** `@shuri/store` has no migrations, so neither does this. Whatever the app's
  own `StoreAdapter` does about schema changes is what these four tables get.

## Role in the monorepo

Depends on `better-auth`, `@shuri/store` (the adapter's target), `@shuri/api` (`FallingHandler`,
`PrincipalResolver`, `ANONYMOUS`), `@shuri/core` (the field types), `@shuri/sdk` (`ShuriPlugin`) and
`@shuri/ui` (the `AdminSession`/`AdminSetupSource`/`UserAdminApi` ports it implements — types only,
never the handler). `@shuri/demo` and `@shuri/benchmarking` mount it; `@shuri/client` uses it as a
devDependency to test its auth routes against the real thing.
