# @shuri/demo

Example app: declares collections/globals, boots a `@shuri/sdk` app backed by `@shuri/store-memory`
with `@shuri/better-auth` and `@shuri/ui`'s admin mounted as plugins, serves it over plain Node HTTP
through `@shuri/sdk/node`, and drives it with `@shuri/client`. Reference consumer of the whole stack,
standalone rather than a dependency of other packages.

## Tree

```
src/
  server.ts                   entry point: builds the app (better-auth + admin), registers hooks, seeds data and the administrator, runs the auth walkthrough, serves, subscribes
  auth-walkthrough.ts          signup -> me -> logout -> login, through @shuri/client bound to app.handler
  collections.ts               example schema: posts (with a schema-declared hook), authors
  globals.ts                    example schema: site, seoDefaults
```

## What each part does

- **Hooks, both ways** — `collections.ts` declares a `beforeChange` hook on `posts` (the Payload
  side: on the schema, run first, here trimming the title and logging who wrote it), and
  `server.ts` registers `afterChange`/`afterDelete` on `posts` through `app.hooks.onCollection`
  (the PocketBase side: at runtime, typed per slug, run after the schema's). Both fire for the seed,
  for a REST write and for a write made by the client, since the store runs them whichever surface
  the write came through; the `context` tells them apart (`principal` is set over HTTP, empty from
  the SDK).
- **auth-walkthrough.ts** — builds a `@shuri/client` whose `fetch` is `app.handler` (no HTTP server
  involved), drives signup -> me -> logout -> login through it — the client's cookie jar captures
  better-auth's session off `Set-Cookie`, so nothing is carried by hand — and prints the equivalent
  `curl` commands.
- **Access rules** — with the auth plugin resolving a principal, an op with no rule needs a
  signed-in one, so `posts` and `authors` declare `access: { list: () => true, view: () => true }`
  and `site` declares `access: { read: () => true }`: reads stay public, writes take a login.
  `seoDefaults` declares nothing, so anonymous gets 401 on it — a useful contrast to poke at.
- **server.ts** — builds `betterAuthPlugin({ options, setup })` (plain-HTTP cookies, a `role`
  column declared through `additionalFields` so it reaches the session, `@better-auth/api-key`
  among the plugins, and `setup.fields` stamping
  `role: "admin"` on whoever completes the first-run form), then calls `create({ collections,
globals, adapter, plugins })` with the plugin and the admin beside it — `authorize` reads that
  role back, so signup stays open while only the administrator edits. Registers the runtime hooks
  (before the seed, so booting already exercises them), seeds one author and one post plus the
  `site` global, seeds the administrator by completing the setup flow on the boot's behalf
  (`ba.setupSource.create`, the same route the form posts to), mints an API key owned by that
  administrator but scoped to `posts` only (`ba.apiKeys.create`) and prints a `curl` carrying it —
  a script holding it writes posts and gets 403 on `site`, however privileged its owner, and
  `exempt: ba.carriesApiKey` keeps the admin's guard out of its way — runs the walkthrough, then
  serves it
  with `createServer(toNodeListener(app)).listen(port)` — `toNodeListener` comes from
  `@shuri/sdk/node`, the bridge between Node's callback-style `http` and the web-standard
  `app.handler` — and logs the admin/auth/collections/globals/OpenAPI/docs URLs plus a
  copy-pasteable `curl -N` for the event stream. Last, it opens a real `@shuri/client` subscription
  to `posts` against the port just served and, once the stream is open, inserts a post through the
  SDK: the frame it logs is the SSE path end to end, from the `afterChange` hook feeding the stream
  to the client's parser reading it.
- **collections.ts** / **globals.ts** — plain `CollectionSchema[]`/`GlobalSchema[]` literals (`as
const satisfies`) covering every field type there is (`text`, `textarea`, `email`, `select`,
  `relation`, `number`, `boolean`), so the admin at `/admin` renders one of each, plus the `access`
  rules above and one schema-declared hook.

## Role in the monorepo

Proof that `@shuri/sdk`, `@shuri/better-auth`, `@shuri/ui` and `@shuri/client` work end to end on a
real (if minimal) HTTP server. Useful as a template for wiring the toolkit into any other engine.
It is also the only app that mounts `@shuri/ui`, so `pnpm demo` is how the admin gets exercised
against a running app.

The admin is behind a login: sign in as `admin@example.com` (the password is printed at boot). Any
other account — signup is open — reaches the admin and is told it has no access, because `authorize`
requires `role: "admin"`, which only the setup flow stamps. Writes to `/collections` and `/globals`
are refused without that session; **reads stay public**, which is `@shuri/ui`'s default and what
makes the API still headless. Remove the administrator seed and the first visit shows the setup form
instead; set `SHURI_SETUP_TOKEN` to gate it.
