# @shuri/demo

Example app: declares collections/globals, boots a `@shuri/sdk` app backed by `@shuri/store-memory`,
and serves it over plain Node HTTP. Reference consumer of the whole stack, standalone rather than a
dependency of other packages.

## Tree

```
src/
  server.ts                   entry point: builds the app, seeds data, starts the server
  collections.ts               example schema: posts, authors
  globals.ts                    example schema: site, seoDefaults
  node-http-adapter.ts          serve(): bridges node:http <-> web-standard Request/Response
```

## What each part does

- **server.ts** — calls `@shuri/sdk`'s `create({ collections, globals, adapter })`, seeds one author
  and one post plus the `site` global on startup, then calls `serve(app.handler, port)`. Logs the
  collections/globals/OpenAPI/docs URLs.
- **collections.ts** / **globals.ts** — plain `CollectionSchema[]`/`GlobalSchema[]` literals (`as
  const satisfies`) showing the field types available (`text`, `textarea`, `email`, `boolean`).
- **node-http-adapter.ts** — `@shuri/sdk`'s `app.handler` is a web-standard `fetch` handler; Node's
  callback-style `http` module needs an adapter to speak that interface. `serve()` is that small
  adapter: buffers the incoming request into a `Request`, then writes the resulting `Response` back
  onto the `ServerResponse`. Deno/Bun already speak the `fetch` interface natively.

## Role in the monorepo

Proof that `@shuri/sdk` works end to end on a real (if minimal) HTTP server. Useful as a template for
wiring the toolkit into any other engine.
