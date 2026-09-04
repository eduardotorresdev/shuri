# @shuri/demo

Example app: declares collections/globals, boots a `@shuri/sdk` app backed by `@shuri/store-memory`,
and serves it over plain Node HTTP. Reference consumer of the whole stack, standalone rather than a
dependency of other packages.

## Tree

```
src/
  server.ts                   entry point: builds the app, seeds data, runs the auth walkthrough, serves
  auth-walkthrough.ts          signup -> me -> logout -> login against app.handler, cookie carried by hand
  collections.ts               example schema: posts, authors
  globals.ts                    example schema: site, seoDefaults
  node-http-adapter.ts          serve(): bridges node:http <-> web-standard Request/Response
```

## What each part does

- **auth-walkthrough.ts** — drives the four credential routes through `app.handler` at boot, reading
  the session cookie off `Set-Cookie` exactly as a browser would, then prints the equivalent `curl`
  commands. Proof that auth works over plain `Request`/`Response`, with no HTTP server involved.
- **server.ts** — calls `@shuri/sdk`'s `create({ collections, globals, adapter, auth })`, subscribes to the
  `posts` collection (before the seed, so booting already exercises it), seeds one author and one
  post plus the `site` global, then calls `serve(app.handler, port)`. Logs the collections/globals/
  OpenAPI/docs URLs plus a copy-pasteable `curl -N` for the event stream.
- **collections.ts** / **globals.ts** — plain `CollectionSchema[]`/`GlobalSchema[]` literals (`as
const satisfies`) showing the field types available (`text`, `textarea`, `email`, `boolean`).
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
wiring the toolkit into any other engine.
