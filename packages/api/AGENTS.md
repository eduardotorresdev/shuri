# @shuri/api

Web-standard (`Request`/`Response`) HTTP handlers that expose collections and globals as REST, their
change events as one Server-Sent Events stream, plus the OpenAPI document and docs page. Framework-agnostic: runs directly on Deno/Bun or behind a thin
adapter (Node, Hono, ...). Depends solely on `@shuri/store` and `@shuri/validate`, keeping
`@shuri/core`/`@shuri/sdk` out of the picture so it stays decoupled from schema authoring.

## Tree

```
src/
  index.ts                    re-exports everything below
  errors.ts                    ApiError base, IssuesApiError, MethodNotAllowedError, InvalidJsonBodyError
  handler.ts                   createHandler: composes the four handlers below into one
  utils/
    request.ts                  readJsonBody: parses the request body, throws InvalidJsonBodyError
    response.ts                  jsonResponse/errorResponse/noContentResponse/toErrorResponse/eventStreamResponse
  collections/
    handler.ts                   createApiHandler: REST for collections (list/insert/get/update/delete)
    routes.ts                    matchCollectionRoute: pathname -> {slug, id?}
    query.ts                     parseQuery: reads/validates limit/offset/where/orderBy off the URL
    errors.ts                    UnknownRouteError, InvalidQueryError
    test-support.ts              test helpers
    test/api.test.ts             integration test
  globals/
    handler.ts                   createGlobalsApiHandler: REST for globals (get/update)
    routes.ts                    matchGlobalRoute: pathname -> {slug}
    test-support.ts
  realtime/
    handler.ts                   createRealtimeHandler: one SSE stream for every store event
    routes.ts                    matchRealtimeRoute: pathname -> is this the stream?
    query.ts                     parseEventQuery: reads/validates collection/global/id/events
    filter.ts                    matchesSelection: does this event belong in this client's stream?
    frame.ts                     toEventFrame: event -> SSE message
    errors.ts                    InvalidEventQueryError
    test-support.ts              fake app over a real bus, readEvents
    test/events.test.ts          integration test
  docs/
    openapi.ts                   buildOpenApiDocument: assembles the full OpenAPI 3.1 document
    json-schema.ts               fieldSchema/collectionSchema/globalSchema (Field -> JSON Schema)
    paths/
      collections.ts              collectionPaths (list/create, get/update/delete)
      globals.ts                  globalPaths (get/update)
      realtime.ts                 realtimePaths (the event stream)
      ref.ts                      schemaRef: $ref into components.schemas
    handler.ts                   createOpenApiHandler: serves /openapi.json and /docs (Scalar)
```

## What each part does

- **handler.ts** — `createHandler({ core, store }, options)` is what a consumer wants: it chains the
  four handlers, each falling through (`undefined`) to the next, in the one order that stays correct
  when the base paths are customized — exact-path matchers (`openapi`, `realtime`), then prefix
  matchers (`globals`, `collections`), then the terminal handler, which 404s instead of falling
  through. It also forwards each base path to the OpenAPI document, so the document can't drift from
  the routes actually served. `@shuri/sdk`'s `app.handler` is this function's return value.
- **collections/handler.ts** — `createApiHandler` mounts `GET/POST {basePath}/:slug` and
  `GET/PATCH/DELETE {basePath}/:slug/:id` on top of a `Store`. Record validation already happens
  inside `CollectionStore.insert`/`update` (`@shuri/store`); this layer's job is only to translate
  thrown errors into HTTP responses via `toErrorResponse`.
- **collections/query.ts** — turns URL search params into the `@shuri/store` `Query` AST, validated
  through `@shuri/validate` combinators, the same way `@shuri/core` validates schema.
- **globals/handler.ts** — `createGlobalsApiHandler` mounts `GET/PATCH {basePath}/:slug`; returns
  `undefined` for anything outside `basePath` so it composes by falling through (see `@shuri/sdk`'s
  `create()`), same as `docs/handler.ts`.
- **realtime/handler.ts** — `createRealtimeHandler` mounts `GET {basePath}` (default `/events`) as a
  single parameterized stream: `?collection=&global=&id=&events=` filter **server-side**, so a
  browser watching several resources needs one connection instead of one per resource (HTTP/1.1 caps
  those at around six). No params streams everything; a selection naming an undeclared slug is a 404
  rather than a stream that stays silently empty. Returns `undefined` outside `basePath`, falling
  through like `globals/handler.ts` and `docs/handler.ts`.
- **utils/response.ts#eventStreamResponse** — opens the stream, subscribing synchronously inside the
  `ReadableStream` constructor (so no event can slip through before the subscription is live), runs
  the teardown exactly once on either close path (the request's `signal` **and** the stream's
  `cancel`), and sends a keep-alive comment every `heartbeatMs` so proxies don't drop an idle
  connection. Tests should pass `heartbeatMs: 0`: an interval left running holds the event loop open.
- **docs/openapi.ts** / **docs/json-schema.ts** / **docs/paths/** — pure, HTTP-free functions that
  build the OpenAPI 3.1 document mirroring the routes above exactly (one path item per resource kind,
  one file each under `docs/paths/`, plus a `components.schemas` entry derived from each schema's
  fields). A collection's `id` is `readOnly`, since the store generates it and rejects a payload
  carrying one. The event union stays out of `components.schemas` on purpose: its keys are raw user
  slugs, so any added name could collide with one.
- **utils/response.ts#toErrorResponse** — the single place that maps known errors (from
  `@shuri/store` and this package) to HTTP status codes; unrecognized errors are rethrown to surface
  as a 500 (or crash) at the hosting engine's own error boundary.

## Role in the monorepo

`@shuri/sdk`'s `create()` just calls `createHandler` for `app.handler`; the composition itself lives
here, next to the handlers it orders. `@shuri/demo` reaches this package only indirectly,
through `@shuri/sdk`.
