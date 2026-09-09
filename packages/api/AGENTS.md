# @shuri/api

Web-standard (`Request`/`Response`) HTTP handlers that expose collections and globals as REST, their
writes as one Server-Sent Events stream (fed by the store's `afterChange`/`afterDelete` hooks), plus
the OpenAPI document and docs page. Framework-agnostic: runs directly on Deno/Bun or behind a thin
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
    handler.ts                   createRealtimeHandler: one SSE stream for every store write
    event.ts                     StoreEvent union (scope + type), STORE_EVENT_TYPES: the wire vocabulary
    source.ts                    subscribeToChanges: wildcard afterChange/afterDelete hooks -> StoreEvent
    routes.ts                    matchRealtimeRoute: pathname -> is this the stream?
    query.ts                     parseEventQuery: reads/validates collection/global/id/events
    filter.ts                    matchesSelection: does this event belong in this client's stream?
    frame.ts                     toEventFrame: event -> SSE message
    errors.ts                    InvalidEventQueryError
    test-support.ts              fake app over a real hook registry, emit, readEvents
    test/events.test.ts          integration test
  access/
    errors.ts                    UnauthenticatedError (401), ForbiddenError (403)
    principal.ts                 PrincipalResolver/AccessOptions, ANONYMOUS, deny, resolveAccessContext
    guarded-collection.ts        guardedCollection: PublicCollection -> authorized PublicCollection
    guarded-global.ts            guardedGlobal: PublicGlobal -> authorized PublicGlobal
    event-gate.ts                createEventGate: which events one connection may receive
    *.test.ts                    unit tests next to each
    test/access.test.ts          integration test: the policy end to end through createHandler
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
    security.ts                  OpenApiSecurity, guardedOperation: security + 401/403 per operation
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
  thrown errors into HTTP responses via `toErrorResponse`. It builds one `OperationContext` per
  request — `{ request }`, plus the `principal` once access resolved it — and hands it to
  `publicCollection`, which forwards it to every store call: that is how a collection's hooks learn
  who did what over HTTP. A hook that throws is the host's error, not the caller's: `toErrorResponse`
  doesn't recognize it and rethrows, so it surfaces as a 500 at the host's boundary.
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
- **realtime/source.ts** — where the stream's events come from, now that `@shuri/store` has no event
  bus: `subscribeToChanges(store.hooks, listener)` registers wildcard `afterChange`/`afterDelete`
  hooks (collections) and `afterChange` (globals) and maps their args to a `StoreEvent` — the way
  PocketBase's realtime is built on its record hooks. Registered on `"*"`, they run after each slug's
  own hooks, so a frame carries the write as every schema-declared hook left it. A throwing
  `listener` is caught and rethrown in a microtask: a stream must never fail the write that produced
  its event, and an _after_ hook that throws would otherwise propagate to the writer. The returned
  unsubscribe is exactly the teardown `eventStreamResponse` expects.
- **realtime/event.ts** — the `StoreEvent` union (`scope` for dispatch, `type` for the `event:`
  line) and `STORE_EVENT_TYPES`, moved here from the store because they are this route's wire
  vocabulary and nothing else uses them. A `delete` carries only the id: no pre-image reaches a
  connection whose rule can no longer be checked against a row that is gone.
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
  slugs, so any added name could collide with one. Two options let another package complete the
  document: `paths` (extra path items, merged last — an auth plugin's routes) and `security` (the
  `components.securitySchemes` plus a `requirements(scope)` every operation is stamped with, carrying
  its own `<slug>:<op>` scope; the event stream gets one without a scope, since it is gated per
  event). Both absent, the document describes an open API, exactly as before.
- **visibility/** — a folder rather than scattered calls, so that `ls src/visibility` answers, in
  full, "where is `hidden` applied, and did we miss a path?". `publicCollection`/`publicGlobal` also
  take the request's `OperationContext` and forward it to every store call, so hooks run over HTTP
  see the same context whichever route they came through. `@shuri/core` declares `hidden` (a
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
- **access/** — the twin of `visibility/`, for the third surface flag: `@shuri/core` declares
  `access` and defines the policy (`access/policy.ts`); this folder is where it is _enforced_, so
  that `ls src/access` answers "where is authorization applied, and did we miss a path?". It only
  runs when a handler gets `access: { principal }` — `createHandler` forwards one `AccessOptions` to
  the collections, globals and realtime handlers alike, and `@shuri/sdk` sets it exactly when the
  host turned auth on. **Without it nothing changes**: an app without auth is as open as before.
  - The principal is resolved **once per request** (`resolveAccessContext`), never per operation,
    since resolving may hit the store.
  - `guardedCollection` wraps **outside** `publicCollection`, so 401/403 is decided before the 400
    a `hidden` field would earn — an anonymous probe can't learn hidden field names. The cost: a
    rule's `Where` can't name a `hidden` field (the query is refused on list, and the redacted record
    never matches on get). Both fail closed.
  - A `Where` is ANDed into the client's `where` on list (`mergeWhere`, so pagination counts only
    visible rows) and checked against the record on get/update/delete. A row the rule excludes
    answers the **same** `RecordNotFoundError` an unknown id does, so existence never leaks; for
    `update` it's the **pre-image** that is checked, like Payload — the rule rules on what the row
    is, not on what the caller would like it to become.
  - `deny` answers **401 to anonymous and 403 to anyone identified**: the first may sign in and
    retry, the second may not.
  - `createEventGate` evaluates `list`/`read` **once per slug per connection** and caches it (a
    stream carries thousands of events, a rule may hit the store), checks a `Where` per event
    against the redacted record, and **drops a `delete` under a `Where`** — it carries no pre-image,
    and guessing would leak that the row existed. An explicit selection (`?collection=x`) the
    principal may not read is refused when the stream is opened, in the same status the REST route
    would give; a silent stream is the hardest failure to debug. Delivery from the hooks is
    synchronous and a rule is async, so admissions are chained on a promise: order is kept, and a
    throwing rule drops that one event and resurfaces out of band, like `source.ts` does for a
    listener.
  - `AccessRuleError` (from core) maps to a **500 naming the rule** in `toErrorResponse`: a rule
    that answers a `Where` where only a boolean makes sense is the host's bug, not the caller's.
  - `collections/query.ts` accepts `FilterOp | FilterOp[]` per field, the array shape `mergeWhere`
    produces, so a client may send it too.
- **falling.ts** — `FallingHandler`, in its own leaf module because `handler.ts` imports
  `globals/handler.ts`: a package that needs the type but must not be imported _by_ `createHandler`
  (`@shuri/ui`, `@shuri/better-auth`) takes it from here with no cycle. `CreateHandlerOptions.handlers` are **prepended**
  to the chain: every built-in handler is relocatable through its own `basePath`, so a collision is
  the consumer's to resolve, while a guard is only a guard if it runs first.
- **utils/response.ts#toErrorResponse** — the single place that maps known errors (from
  `@shuri/store` and this package) to HTTP status codes; unrecognized errors are rethrown to surface
  as a 500 (or crash) at the hosting engine's own error boundary. It branches on `IssuesApiError` /
  `ApiError` — inheritance, not a registry of concrete classes — which is why `@shuri/ui` and
  `@shuri/better-auth` can add their own errors without this file changing, and why the import edge
  stays `plugin -> api`.

## Role in the monorepo

`@shuri/sdk`'s `create()` just calls `createHandler` for `app.handler`; the composition itself lives
here, next to the handlers it orders — which is also why an extra handler arrives through
`options.handlers` rather than by `@shuri/sdk` wrapping the composed handler, since wrapping can only
ever express "outermost". `@shuri/demo` reaches this package only indirectly,
through `@shuri/sdk`.
