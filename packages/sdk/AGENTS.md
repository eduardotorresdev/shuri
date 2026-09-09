# @shuri/sdk

The facade tying schema (`@shuri/core`) + persistence adapter (`@shuri/store`) + HTTP handlers
(`@shuri/api`) + authentication (`@shuri/auth`) into a single app via `create()`:
`app.collections.<slug>`, `app.globals.<slug>`, `app.auth`, `app.hooks`, `app.schema`, `app.handler`. This is the
package most consumers should import from directly.

## Tree

```
src/
  index.ts                    re-exports create.js and sveltekit.js, plus the auth/core types
  create.ts                    create(), ShuriApp, CreateConfig, AppCollections/AppGlobals
  create.test.ts               unit tests for create()
  create.hooks.test.ts         unit tests for app.hooks
  sveltekit.ts                 toSvelteKitHandle(app): routes a SvelteKit Handle to app.handler
  sveltekit.test.ts
  node.ts                      toNodeListener(app): node:http <-> web-standard Request/Response bridge
  node.test.ts                 boots a real http.Server on port 0 and drives it with fetch
  test/
    handler.test.ts             integration test exercising app.handler end to end
    auth.test.ts                 integration test for an app with auth turned on
    access.test.ts               integration test: Where rules and a scoped client, end to end
```

## What each part does

- **create.ts** — `create({ collections, globals, adapter, auth?, api?, globalsApi?, realtime?, openapi? })`: 0. If `auth` is set, checks the consumer's slugs against the ones `@shuri/auth` reserves and merges
  `authCollections` in ahead of them.
  1. Calls `createCore` (`@shuri/core`) to validate the declared schema.
  2. Calls `createStore` (`@shuri/store`) to bind that `Core` to `adapter`.
  3. Builds `app.collections`/`app.globals`: one typed `CollectionStore`/`GlobalStore` per declared
     slug, so `app.collections.posts.insert(...)` and `app.globals.site.get()` are typed from the
     schema with no manual typing.
  4. If `auth` is set, calls `createAuth({ store, scopes, ...config.auth })` for `app.auth`, with
     `scopes = derivedScopes(core.collections, core.globals)` — the `<slug>:<op>` universe a client
     role expands against, which only the app knows.
  5. Builds `app.hooks`, the typed facade over `store.hooks` (see below), and `app.schema`, the
     consumer's own `{ collections, globals }` — whose _type_ is what `@shuri/client` is instantiated
     from (`createClient<typeof app.schema>`), so the client never has to repeat the schema.
  6. Builds `app.handler` by calling `createHandler` (`@shuri/api`), which composes the collections,
     globals, event stream and OpenAPI handlers — the ordering and the base-path forwarding live
     there, so this package only forwards the per-handler options it was given. The auth handler goes
     in through `options.handlers`, which prepends it, and `auth.principal` through `options.access`,
     which is what turns the `access` rules of every collection and global on, and
     `auth.openapi.paths`/`security` through `options.openapi`, so `/openapi.json` describes the auth
     routes and the cookie/bearer/client-credentials schemes (a host's own `openapi` options win). **Without `auth`,
     no `access` is passed and every route stays open**, exactly as before.

- **sveltekit.ts** — `toSvelteKitHandle(app, { base })`: routing glue, not a protocol bridge.
  SvelteKit already hands the handler a `Request`, so requests under `base` (default `/api`) go to
  `app.handler` and everything else falls through to `resolve`.
- **node.ts** — `toNodeListener(app)`: the protocol bridge Node needs, since its `http` module is
  callback-style and knows nothing of `Request`/`Response`. Buffers the incoming body into a
  `Request`, then writes the `Response` back in the cheapest shape its body allows: a
  single-chunk body (every REST response) goes out with `Content-Length` in **one write**; a body
  whose first chunk isn't there by the next event-loop turn (an event stream) gets its headers
  flushed at once and is then **streamed** chunk by chunk with backpressure — buffering it would
  hang forever. The two are told apart by racing the first `read()` against a `setImmediate`
  (`settled`), so no content-type sniffing. This one-write path is what took the bridge from
  ~3/4 of a request's cost to a fraction of it (see `benchmarking/BASELINE.md`). Keeps
  multiple `Set-Cookie` values apart via `headers.getSetCookie()` (the OIDC callback sets two), and
  wires the client's disconnect (`res`'s "close") to the `Request`'s `AbortSignal`, which
  Deno/Bun/Workers provide natively and Node does not. Published as the **subpath**
  `@shuri/sdk/node`, deliberately not re-exported from `index.ts`, so importing `@shuri/sdk` on
  Deno/Bun/Workers never pulls `node:http` in.

`buildCollections`/`buildGlobals` are driven by **the consumer's own tuple, not `core.collections`**.
With auth on, the core also holds `users`, `_sessions`, `_accounts`, `_oidc_credentials`, `_clients`
and `_client_tokens`; iterating it would put six keys on the runtime object that `AppCollections<T>`
never declares. Those
collections deliberately stay off `app.collections` anyway: `app.collections._sessions.insert(...)`
would walk straight past every invariant a session has, and typed access goes through `app.auth`
(`app.auth.oidcCredentials` for the OIDC one, `app.auth.clients` for the M2M ones).

`app.auth` is typed `A extends AuthConfig ? AuthApi : undefined`, with `A` naked so the conditional
distributes: no `auth` gives `undefined`, an object literal gives `AuthApi`, and a variable typed
`AuthConfig | undefined` gives `AuthApi | undefined`. `A` must **not** be `const`.

A consumer collection reusing `users`/`_sessions`/`_accounts`/`_oidc_credentials` throws
`AuthSlugCollisionError`, which
names the owner and suggests a rename plus a `relation` to `users` — rather than letting `createCore`
report an opaque duplicate slug. Renaming the auth slugs per host was rejected: `authCollections`
would stop being a constant and lose the literal slugs `InferCollection` reads.

This package re-exports `AuthConfig`, `AuthApi`, `AuthUser`, `AuthSession`, the client types, the
provider helpers, the auth error classes and `ForbiddenError`, plus the `Access*` rule types from
`@shuri/core`, so a consumer never needs `@shuri/auth` as a direct dependency.

**Reacting to writes is a hook, observing them is a client.** There is no in-process event bus and no
`subscribe` on a store: a server-side reaction goes through the lifecycle hooks `@shuri/core`
declares — on the schema (`hooks: { beforeChange: [...] }`, Payload style) or at runtime through
`app.hooks.onCollection(slug | "*", name, fn)` / `app.hooks.onGlobal(...)` (PocketBase style), the
schema's first. `app.hooks` is a thin typed facade over `store.hooks`: a hook on `"posts"` sees
`doc`/`data` typed from that collection's fields, `"*"` sees the generic record. A schema-declared
hook is typed over the generic record too, since a literal can't reference its own `fields`. Hooks
run whichever surface the write came through, and one made over HTTP carries the `request` (and
`principal`, with auth on) in `context`. The `/events` route is fed by those same `afterChange`/
`afterDelete` hooks (`@shuri/api`'s `realtime/source.ts`), and `@shuri/client` is the package that
consumes it from outside the process: `client.collections("posts").subscribe(...)` is where the old
per-slug `subscribe` went.

## Role in the monorepo

The single entry point meant for end users of the toolkit (`@shuri/demo` is the reference consumer).
Everything below it (`core`, `store`, `api`) is composable on its own, but `sdk` is what wires them
together with sensible defaults.

`config.handlers` is how a surface outside that core arrives: it is forwarded to `@shuri/api`'s
`createHandler`, which runs each one ahead of every built-in route — but still after nothing, and
crucially _before_ auth's own, so a guard passed there really does guard them while login and signup
remain reachable. `@shuri/ui`'s admin mounts this way, which is why this package does not depend on
it: an app that wants no admin pays nothing for it.

It also accepts a **function** of a `HandlerContext`, for a handler that needs something `create()`
builds. Today that is the `AuthApi`, which cannot be passed in from outside because it needs the
store, which needs the core:

```ts
handlers: ({ auth }) => [
  createAdminHandler({ collections, globals }, { auth: { auth } }),
];
```

An array and a function tell themselves apart at runtime, so both forms go in the same option with no
wrapper. `HandlerContext` is an object rather than the `AuthApi` alone so the next thing a handler
needs is not a breaking change for every host.

`config.plugins` goes one step further, for the case `handlers` cannot serve: something whose
persistence lives in the app's own store. Its collections must be in the schema _before_ the store is
built and its handlers need that store _once it is_ — a circle only `create()` can close, since it
builds both. `@shuri/better-auth` is exactly that shape. Plugin collections are merged into the
schema but kept off `app.collections`, for the same reason auth's are: reaching past the package that
owns a table walks straight past its invariants. A slug already claimed fails with
`PluginSlugCollisionError`, which names the plugin that brought it — the one thing a host needs in
order to fix it.

Use `handlers` when a plain handler is all you have, `plugins` when collections are involved.
