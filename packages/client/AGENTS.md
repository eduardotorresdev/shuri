# @shuri/client

The HTTP SDK of a Shuri app, shaped like PocketBase's JS SDK: talks to `@shuri/api`'s REST routes,
better-auth's auth routes and the `/events` stream over plain `fetch`, typed from the same schema
the server was built with. Zero runtime dependencies; `@shuri/core` is a type-only dependency (for
`Query`, `WithId`, `InferCollections`/`InferGlobals`). Runs in a browser, Node, Deno, Bun or a
worker — anything with `fetch`, `ReadableStream` and `AbortController`.

## Tree

```
src/
  index.ts                    re-exports everything below
  create.ts                    createClient(), ShuriClient, ClientSchema, ClientCollections/ClientGlobals, RealtimeClient
  http.ts                      createHttp/Http: URL join, JSON bodies, bearer header, cookie jar, credentials, error mapping
  errors.ts                    ClientError { status, message, issues? }, toClientError
  query.ts                     toSearchParams: Query -> the params api/collections/query.ts reads
  collections.ts               collectionClient: list/get/create/update/delete/subscribe for one slug
  globals.ts                   globalClient: get/update/subscribe for one slug
  auth.ts                      authClient: signup/login/logout/me/socialSignInUrl/setToken/clearToken/getToken
  realtime/
    sse.ts                      parseEventStream/parseMessage: the SSE line protocol
    subscribe.ts                subscribe(): fetch-based stream with reconnect, EventSelection, Unsubscribe
    sse.test.ts
  errors.test.ts, query.test.ts
  test/
    support.ts                  createTestApp: a real create() app + a client bound to app.handler
    collections.test.ts, globals.test.ts, auth.test.ts, realtime.test.ts   integration tests
```

## What each part does

- **create.ts** — `createClient<typeof app.schema>({ baseUrl, fetch?, token?, credentials?,
paths? })`. The one type parameter is the app's own `{ collections, globals }`
  (`app.schema` in `@shuri/sdk`, or the two literals a server module exports), and it only shapes
  the types: nothing about the schema is downloaded or bundled, which is what keeps hooks and access
  rules — server functions — out of a browser. `client.collections.posts` / `client.globals.site`
  mirror `app.collections.posts` / `app.globals.site` on the server, typed by the same
  `T[number] as C["slug"]` mapping. Because the slugs exist only as types, the two maps are lazy
  objects (a `Proxy` building one per-slug client on first access, then caching it) rather than the
  eagerly populated records the SDK can build from its runtime schema. `client.realtime.subscribe
(selection, listener)` is the raw, untyped stream the two typed `subscribe`s delegate to. `paths`
  mirrors the server's `basePath` options, for an app that relocated a handler.
- **http.ts** — the one seam every request goes through. The base URL keeps whatever prefix it was
  given, so joining is concatenation, not `new URL(path, base)` (which would drop `/api`). A JSON
  body sets `content-type`; a held token is sent as `Authorization: Bearer`; `credentials` defaults
  to `"include"` so a browser rides on the session cookie. A small cookie jar absorbs every
  `Set-Cookie` a response carries and sends them back as `Cookie` — empty in a browser, which hides
  the header and carries the cookie itself; the whole session story in Node, Deno or Bun. A
  state-changing request also names the server as `Origin` (from `baseUrl`, when absolute): better-auth
  refuses a cookie-carrying write without one, its CSRF check, and a browser ignores the header
  (`origin` is forbidden to `fetch`) and sends its own — so it only ever speaks for a script. `json()`
  throws `ClientError` for any non-2xx and resolves `undefined` for a 204. `fetch` is injectable: the tests bind it to
  `app.handler` and never open a socket.
- **errors.ts** — `ClientError` is the single error type: the HTTP status, the server's `error` (or
  better-auth's `message`), and the `issues` a 400 carries, so a form can show them per field.
- **auth.ts** — better-auth's credential routes (`sign-up/email`, `sign-in/email`, `sign-out`,
  `get-session`) plus the bearer this client may send. Sessions travel two ways and the client
  supports both without being told which: in a browser `Set-Cookie` is invisible to scripts
  (`getSetCookie()` answers `[]`), so nothing is captured and the cookie does the work; in Node the
  header is visible and `http.ts`'s jar carries the session cookie from `signup`/`login` onwards.
  `signup` supplies the address as `name` when none was given, since better-auth requires one;
  `me()` turns better-auth's `null`-with-200 into the 401 every other route answers; `logout`
  forgets the jar. `socialSignInUrl` posts to `sign-in/social` and hands back the URL — a social
  sign-in is a browser navigation, not a fetch. `setToken` exists for a host running better-auth's
  `bearer` plugin, or a scheme of its own.
- **realtime/subscribe.ts** — `fetch` rather than `EventSource`, on purpose: `EventSource` can't
  send an `Authorization` header, and a bearer-authenticated client (a Node script, a mobile app)
  needs exactly that. Opens `GET {events}?collection=…&global=…&id=…&events=…` with `accept:
text/event-stream`, decodes frames through `sse.ts`, and reconnects with a capped exponential
  backoff (`retryDelayMs` doubling up to `maxRetryDelayMs`) when the connection drops or the server
  closes it. A **4xx is final**: the selection is wrong or the principal may not read it, and
  retrying would only repeat the refusal — it is reported through `onError` and the subscription
  ends. A 5xx retries like a drop. `onOpen` fires per (re)connection, which is also how a test
  knows the stream is live before it writes. The returned function and the `signal` option both end
  the subscription.
- **realtime/sse.ts** — the SSE line protocol: `event:` names the message, `data:` lines are joined
  with newlines, `:` lines (the server's keep-alive) are skipped, CRLF is tolerated, and a message
  split across chunks is reassembled. The same rules `@shuri/api`'s `readEvents` test helper
  applies, now as a shipped parser.
- **query.ts** — `toSearchParams` is the exact inverse of `@shuri/api`'s `parseQuery`: `limit`/
  `offset` as numbers, `where`/`orderBy` as JSON. Change one, change the other.

## Role in the monorepo

The consumer-side counterpart of `@shuri/sdk`: the SDK is what a host runs the app with, this is
what a browser, a script or another service talks to it with. It is the home of `subscribe` now that
`@shuri/store` has no event bus — reacting to a write inside the process is a hook (`app.hooks`,
or `hooks` on the schema); observing it from outside is this package over `/events`. `@shuri/sdk`,
`@shuri/better-auth` and `@shuri/store-memory` are devDependencies only, for the integration tests:
none of them imports this package, so there is no cycle. `@shuri/demo` drives its auth walkthrough and an SSE
subscription through it.
