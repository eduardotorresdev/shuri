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
  falling.ts                   FallingHandler: the "answer or return undefined" contract, as a leaf module
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
  visibility/
    guards.ts                    assertWritableRecord/assertQueryableFields, over @shuri/core's redact.ts
    errors.ts                    HiddenFieldError (400)
    internal.ts                  servableCollection: resolves a slug, throwing for an internal one
    public-collection.ts         PublicCollection/publicCollection
    public-global.ts             PublicGlobal/publicGlobal
    public-event.ts              publicEvent: event -> streamable event, or undefined
    test-support.ts              schemas declaring hidden fields / internal collections
    test/visibility.test.ts      integration test
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
- **visibility/** — a folder rather than scattered calls, so that `ls src/visibility` answers, in
  full, "where is `hidden` applied, and did we miss a path?". `@shuri/core` declares `hidden` (a
  field) and `internal` (a collection), validates them, and defines what they mean
  (`hiddenFieldNames`/`redactRecord`/`redactRecords`/`servableCollections`, in its own `redact.ts`);
  this folder is where they are _enforced_, importing those functions rather than redefining them —
  so a future consumer of `@shuri/core` outside this package shares the exact same definition.
  - `redactRecord` (in `@shuri/core`) **copies, never mutates**: an adapter may hand out the live
    object it stores (`createMemoryAdapter` does), so deleting a key would erase the value from the
    store for good.
  - `servableCollection` throws `@shuri/store`'s own `UnknownCollectionError` for an `internal`
    collection — the same class, message and body an undeclared slug produces. That identity is the
    point: probing `/collections/_sessions` must teach nothing.
  - `publicCollection`/`publicGlobal` return a **narrower interface** (only the operations REST
    exposes; no `findOne`/`count`/`subscribe`/`schema`), so a handler holding one has no unredacted
    path available. Redacting inside each `jsonResponse` would work right up to the first of the four
    call sites somebody forgets.
  - `publicEvent` returns **one thing** (`StoreEvent | undefined`) rather than a filter plus a
    mapper: a two-part contract can be applied half-way, and half-applied here means streaming a
    password hash to every connected client.
  - A `hidden` field is **not writable over HTTP — it is a 400**, not a silent drop: `PATCH
{"passwordHash": ...}` would otherwise be an authentication bypass, and a caller who believes it
    changed a password and didn't has an incident with no log line. `rejectsId` one layer down sets
    the same precedent. Filtering and sorting by a hidden field is refused for the same reason: a
    `contains` filter reads a redacted value back one guess at a time. The cost is that "what may be
    written" is now expressed in two layers (core validates the shape, this decides the visibility),
    mitigated by both deriving from the one flag.
- **falling.ts** — `FallingHandler`, in its own leaf module because `handler.ts` imports
  `globals/handler.ts`: a package that needs the type but must not be imported _by_ `createHandler`
  (`@shuri/auth`) takes it from here with no cycle. `CreateHandlerOptions.handlers` are **prepended**
  to the chain: every built-in handler is relocatable through its own `basePath`, so a collision is
  the consumer's to resolve, while a guard is only a guard if it runs first.
- **utils/response.ts#toErrorResponse** — the single place that maps known errors (from
  `@shuri/store` and this package) to HTTP status codes; unrecognized errors are rethrown to surface
  as a 500 (or crash) at the hosting engine's own error boundary. It branches on `IssuesApiError` /
  `ApiError` — inheritance, not a registry of concrete classes — which is why `@shuri/auth` can add a
  dozen errors without this file changing, and why the import edge stays `auth -> api`.

## Role in the monorepo

`@shuri/sdk`'s `create()` just calls `createHandler` for `app.handler`; the composition itself lives
here, next to the handlers it orders — which is also why an extra handler arrives through
`options.handlers` rather than by `@shuri/sdk` wrapping the composed handler, since wrapping can only
ever express "outermost". `@shuri/demo` reaches this package only indirectly,
through `@shuri/sdk`.
