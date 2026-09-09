# @shuri/sdk

The facade tying schema (`@shuri/core`) + persistence adapter (`@shuri/store`) + HTTP handlers
(`@shuri/api`) + plugins (`@shuri/better-auth`, `@shuri/ui`'s admin) into a single app via
`create()`: `app.collections.<slug>`, `app.globals.<slug>`, `app.hooks`, `app.schema`,
`app.handler`. This is the package most consumers should import from directly.

## Tree

```
src/
  index.ts                    re-exports create.js, plugin.js and sveltekit.js, plus the api/core types
  create.ts                    create(), ShuriApp, CreateConfig, AppCollections/AppGlobals
  create.test.ts               unit tests for create()
  plugin.ts                    ShuriPlugin/PluginContext, collectPluginCollections/Access/OpenApi
  plugin.test.ts
  create.hooks.test.ts         unit tests for app.hooks
  sveltekit.ts                 toSvelteKitHandle(app): routes a SvelteKit Handle to app.handler
  sveltekit.test.ts
  node.ts                      toNodeListener(app): node:http <-> web-standard Request/Response bridge
  node.test.ts                 boots a real http.Server on port 0 and drives it with fetch
  test/
    handler.test.ts             integration test exercising app.handler end to end
    handlers.test.ts             config.handlers and config.plugins: order, collections, principal
    access.test.ts               integration test: Where rules over a plugin's principal, end to end
```

## What each part does

- **create.ts** — `create({ collections, globals, adapter, handlers?, plugins?, api?, globalsApi?, realtime?, openapi? })`: 0. Collects every plugin's collections (`collectPluginCollections`), refusing a slug the app
  already declares, and merges them in ahead of the consumer's own.
  1. Calls `createCore` (`@shuri/core`) to validate the declared schema.
  2. Calls `createStore` (`@shuri/store`) to bind that `Core` to `adapter`.
  3. Builds `app.collections`/`app.globals`: one typed `CollectionStore`/`GlobalStore` per declared
     slug, so `app.collections.posts.insert(...)` and `app.globals.site.get()` are typed from the
     schema with no manual typing.
  4. Builds `app.hooks`, the typed facade over `store.hooks` (see below), and `app.schema`, the
     consumer's own `{ collections, globals }` — whose _type_ is what `@shuri/client` is instantiated
     from (`createClient<typeof app.schema>`), so the client never has to repeat the schema.
  5. Builds `app.handler` by calling `createHandler` (`@shuri/api`), which composes the collections,
     globals, event stream and OpenAPI handlers — the ordering and the base-path forwarding live
     there, so this package only forwards the per-handler options it was given. `config.handlers`
     go in first, then every plugin's handlers (resolved with the store), through `options.handlers`,
     which prepends them; the one plugin declaring a `principal` goes in through `options.access`,
     which is what turns the `access` rules of every collection and global on; and every plugin's
     `openapi` (`paths`/`security`) through `options.openapi`, so `/openapi.json` describes the
     plugin's routes and how requests authenticate (a host's own `openapi` options win). **Without a
     principal-resolving plugin, no `access` is passed and every route stays open**, exactly as
     before.

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
With `@shuri/better-auth` on, the core also holds its `user`, `session`, `account` and
`verification` tables; iterating it would put keys on the runtime object that `AppCollections<T>`
never declares. Those collections deliberately stay off `app.collections` anyway:
`app.collections.session.insert(...)` would walk straight past every invariant the plugin owning that
table maintains, and administration goes through the plugin's own surface (`ba.sessionSource.users`).

This package re-exports `ForbiddenError`/`UnauthenticatedError` and the `PrincipalResolver`/
`AccessOptions`/`FallingHandler` types from `@shuri/api`, plus the `Access*` rule types from
`@shuri/core`, so a consumer writing rules or a plugin never needs those as direct dependencies.

**Reacting to writes is a hook, observing them is a client.** There is no in-process event bus and no
`subscribe` on a store: a server-side reaction goes through the lifecycle hooks `@shuri/core`
declares — on the schema (`hooks: { beforeChange: [...] }`, Payload style) or at runtime through
`app.hooks.onCollection(slug | "*", name, fn)` / `app.hooks.onGlobal(...)` (PocketBase style), the
schema's first. `app.hooks` is a thin typed facade over `store.hooks`: a hook on `"posts"` sees
`doc`/`data` typed from that collection's fields, `"*"` sees the generic record. A schema-declared
hook is typed over the generic record too, since a literal can't reference its own `fields`. Hooks
run whichever surface the write came through, and one made over HTTP carries the `request` (and
`principal`, with an auth plugin on) in `context`. The `/events` route is fed by those same `afterChange`/
`afterDelete` hooks (`@shuri/api`'s `realtime/source.ts`), and `@shuri/client` is the package that
consumes it from outside the process: `client.collections("posts").subscribe(...)` is where the old
per-slug `subscribe` went.

## Role in the monorepo

The single entry point meant for end users of the toolkit (`@shuri/demo` is the reference consumer).
Everything below it (`core`, `store`, `api`) is composable on its own, but `sdk` is what wires them
together with sensible defaults.

`config.handlers` is how a plain handler outside that core arrives: it is forwarded to `@shuri/api`'s
`createHandler`, which runs each one ahead of every built-in route — and ahead of every plugin's own,
so a guard passed there really does guard them while login and signup remain reachable.

`config.plugins` is for the case `handlers` cannot serve: something whose persistence lives in the
app's own store, or that identifies who is asking. A `ShuriPlugin` contributes **collections** (in
the schema _before_ the store is built), **handlers** (resolved with that store _once it is_ — a
circle only `create()` can close, since it builds both), a **principal** resolver (at most one plugin
may; two throw `PluginPrincipalConflictError`) and its **openapi** description. `@shuri/better-auth`
is exactly that shape, and `@shuri/ui`'s admin mounts as a plugin beside it so it can be handed the
session source in the same `create()` call. Plugin collections are merged into the schema but kept
off `app.collections`: reaching past the package that owns a table walks straight past its
invariants. A slug already claimed fails with `PluginSlugCollisionError`, which names the plugin that
brought it — the one thing a host needs in order to fix it.

```ts
const ba = betterAuthPlugin({ options: { emailAndPassword: { enabled: true } } });

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
          { auth: { auth: ba.sessionSource, basePath: ba.basePath } },
        ),
      ],
    },
  ],
});
```

This package does not depend on `@shuri/ui` or `@shuri/better-auth`: both arrive through `plugins`,
so an app that wants neither pays nothing for them.
