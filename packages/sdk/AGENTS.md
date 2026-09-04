# @shuri/sdk

The facade tying schema (`@shuri/core`) + persistence adapter (`@shuri/store`) + HTTP handlers
(`@shuri/api`) + authentication (`@shuri/auth`) into a single app via `create()`:
`app.collections.<slug>`, `app.globals.<slug>`, `app.auth`, `app.handler`. This is the package most consumers should import from directly.

## Tree

```
src/
  index.ts                    re-exports create.js
  create.ts                    create(), ShuriApp, CreateConfig, AppCollections/AppGlobals
  create.test.ts               unit tests for create()
  test/
    handler.test.ts             integration test exercising app.handler end to end
    auth.test.ts                 integration test for an app with auth turned on
```

## What each part does

- **create.ts** — `create({ collections, globals, adapter, auth?, api?, globalsApi?, realtime?, openapi? })`: 0. If `auth` is set, checks the consumer's slugs against the ones `@shuri/auth` reserves and merges
  `authCollections` in ahead of them.
  1. Calls `createCore` (`@shuri/core`) to validate the declared schema.
  2. Calls `createStore` (`@shuri/store`) to bind that `Core` to `adapter`.
  3. Builds `app.collections`/`app.globals`: one typed `CollectionStore`/`GlobalStore` per declared
     slug, so `app.collections.posts.insert(...)` and `app.globals.site.get()` are typed from the
     schema with no manual typing.
  4. If `auth` is set, calls `createAuth({ store, ...config.auth })` for `app.auth`.
  5. Builds `app.handler` by calling `createHandler` (`@shuri/api`), which composes the collections,
     globals, event stream and OpenAPI handlers — the ordering and the base-path forwarding live
     there, so this package only forwards the per-handler options it was given. The auth handler goes
     in through `options.handlers`, which prepends it.

`buildCollections`/`buildGlobals` are driven by **the consumer's own tuple, not `core.collections`**.
With auth on, the core also holds `users`, `_sessions` and `_accounts`; iterating it would put three
keys on the runtime object that `AppCollections<T>` never declares. Those collections deliberately
stay off `app.collections` anyway: `app.collections._sessions.insert(...)` would walk straight past
every invariant a session has, and typed access goes through `app.auth`.

`app.auth` is typed `A extends AuthConfig ? AuthApi : undefined`, with `A` naked so the conditional
distributes: no `auth` gives `undefined`, an object literal gives `AuthApi`, and a variable typed
`AuthConfig | undefined` gives `AuthApi | undefined`. `A` must **not** be `const`.

A consumer collection reusing `users`/`_sessions`/`_accounts` throws `AuthSlugCollisionError`, which
names the owner and suggests a rename plus a `relation` to `users` — rather than letting `createCore`
report an opaque duplicate slug. Renaming the auth slugs per host was rejected: `authCollections`
would stop being a constant and lose the literal slugs `InferCollection` reads.

This package re-exports `AuthConfig`, `AuthApi`, `AuthUser`, `AuthSession`, the provider helpers and
the auth error classes, so a consumer never needs `@shuri/auth` as a direct dependency.

`app.collections.<slug>.subscribe(...)`/`app.globals.<slug>.subscribe(...)` and the `/events` route
are two views of one `store.events` bus: a write through the SDK shows up on the HTTP stream and vice
versa. The bus itself stays off `ShuriApp`, like `core`/`store` — the public surface is the per-slug
`subscribe` and the route.

## Role in the monorepo

The single entry point meant for end users of the toolkit (`@shuri/demo` is the reference consumer).
Everything below it (`core`, `store`, `api`) is composable on its own, but `sdk` is what wires them
together with sensible defaults.
