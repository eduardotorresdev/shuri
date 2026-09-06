# @shuri/demo

Example app: declares collections/globals, boots a `@shuri/sdk` app backed by `@shuri/store-memory`,
and serves it over plain Node HTTP. Reference consumer of the whole stack, standalone rather than a
dependency of other packages.

## Tree

```
src/
  server.ts                   entry point: builds the app, seeds data, runs the auth walkthrough, serves
  better-auth-server.ts        the same app with @shuri/better-auth in place of @shuri/auth
  auth-walkthrough.ts          signup -> me -> logout -> login against app.handler, cookie carried by hand
  collections.ts               example schema: posts, authors
  globals.ts                    example schema: site, seoDefaults
  node-http-adapter.ts          serve(): bridges node:http <-> web-standard Request/Response
```

## What each part does

- **auth-walkthrough.ts** — drives the four credential routes through `app.handler` at boot, reading
  the session cookie off `Set-Cookie` exactly as a browser would, then prints the equivalent `curl`
  commands. Proof that auth works over plain `Request`/`Response`, with no HTTP server involved.
- **server.ts** — calls `@shuri/sdk`'s `create({ collections, globals, adapter, auth, handlers })`,
  mounting `@shuri/ui`'s admin at `/admin` through `handlers` — as a **function**, so the admin can be
  handed the `AuthApi` that same call builds. Seeds one admin account and authorizes it by email,
  since `@shuri/auth`'s `users` declares no role field. Subscribes to the
  `posts` collection (before the seed, so booting already exercises it), seeds one author and one
  post plus the `site` global, then calls `serve(app.handler, port)`. Logs the collections/globals/
  OpenAPI/docs URLs plus a copy-pasteable `curl -N` for the event stream.
- **collections.ts** / **globals.ts** — plain `CollectionSchema[]`/`GlobalSchema[]` literals (`as
const satisfies`) covering every field type there is (`text`, `textarea`, `email`, `select`,
  `relation`, `number`, `boolean`), so the admin at `/admin` renders one of each.
- **node-http-adapter.ts** — `@shuri/sdk`'s `app.handler` is a web-standard `fetch` handler; Node's
  callback-style `http` module needs an adapter to speak that interface. `serve()` is that small
  adapter: buffers the incoming request into a `Request`, then **streams** the resulting `Response`
  body onto the `ServerResponse` (headers flushed first, `pipeline` handling backpressure). Buffering
  the body instead would hang forever on an event stream, which never ends. It keeps multiple `Set-Cookie`
  values apart via `headers.getSetCookie()` — `Object.fromEntries` alone collapses them into one
  comma-joined header no browser parses back, and the OIDC callback really does set two. It also
  wires the client's disconnect (`res`'s "close") to the `Request`'s `AbortSignal`, which Deno/Bun/Workers
  provide natively and Node does not — without it a stream would never learn its client is gone.

## Role in the monorepo

Proof that `@shuri/sdk` works end to end on a real (if minimal) HTTP server. Useful as a template for
wiring the toolkit into any other engine. It is also the only consumer of `@shuri/ui`, so
`pnpm demo` is how the admin gets exercised against a running app.

`pnpm --filter @shuri/demo start:better-auth` runs **better-auth-server.ts** instead: the same
collections, globals and admin, with `@shuri/better-auth` swapped in for `@shuri/auth`. It seeds no
account and carries no password in source — the first visit shows the setup form, and whoever
completes it becomes the administrator. Set `SHURI_SETUP_TOKEN` to gate that form. The diff
between the two files is the whole cost of changing auth implementation — the admin call is identical
apart from the session source and better-auth's own credential paths.

The admin is behind a login: sign in as `admin@example.com` (the password is printed at boot). Any
other account — signup is open — reaches the admin and is told it has no access, because `authorize`
matches that one email. Writes to `/collections` and `/globals` are refused without that session;
**reads stay public**, which is `@shuri/ui`'s default and what makes the API still headless.
