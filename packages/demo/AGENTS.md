# @shuri/demo

Example app: declares collections/globals, boots a `@shuri/sdk` app backed by `@shuri/store-memory`,
serves it over plain Node HTTP through `@shuri/sdk/node`, and drives it with `@shuri/client`. Reference consumer of the whole
stack, standalone rather than a dependency of other packages.

## Tree

```
src/
  server.ts                   entry point: builds the app, mounts the admin, registers hooks, seeds data, runs the auth walkthrough, serves, subscribes
  better-auth-server.ts        the same app with @shuri/better-auth in place of @shuri/auth
  auth-walkthrough.ts          signup -> me -> logout -> login -> token, through @shuri/client bound to app.handler
  collections.ts               example schema: posts (with a schema-declared hook), authors
  globals.ts                    example schema: site, seoDefaults
```

## What each part does

- **Hooks, both ways** — `collections.ts` declares a `beforeChange` hook on `posts` (the Payload
  side: on the schema, run first, here trimming the title and logging who wrote it), and
  `server.ts` registers `afterChange`/`afterDelete` on `posts` through `app.hooks.onCollection`
  (the PocketBase side: at runtime, typed per slug, run after the schema's). Both fire for the seed,
  for a REST write and for a write made by the client, since the store runs them whichever surface
  the write came through; the `context` tells them apart (`principal` is set over HTTP with auth on,
  empty from the SDK).
- **auth-walkthrough.ts** — builds a `@shuri/client` whose `fetch` is `app.handler` (no HTTP server
  involved), drives signup -> me -> logout -> login through it — the client captures the session off
  `Set-Cookie` and sends it as a bearer, so nothing is carried by hand — then provisions a client
  (`app.auth.clients.create`, role `integrator`) and obtains a token scoped to `posts:list` through
  `client.auth.token`, and prints the equivalent `curl` commands for both.
- **Access rules** — with auth on, an op with no rule needs a signed-in principal, so `posts` and
  `authors` declare `access: { list: () => true, view: () => true }` and `site` declares
  `access: { read: () => true }`: reads stay public, writes take a login (or a client whose token
  carries the scope). `seoDefaults` declares nothing, so anonymous gets 401 on it — a useful
  contrast to poke at. `server.ts` declares one client role, `integrator: ["posts:*"]`.
- **server.ts** — calls `@shuri/sdk`'s `create({ collections, globals, adapter, auth })`, registers
  the runtime hooks (before the seed, so booting already exercises them), seeds one author and one
  post plus the `site` global, runs the walkthrough, then serves it with
  `createServer(toNodeListener(app)).listen(port)` — `toNodeListener` comes from `@shuri/sdk/node`,
  the bridge between Node's callback-style `http` and the web-standard `app.handler` — and logs
  the collections/globals/OpenAPI/docs URLs plus a copy-pasteable `curl -N` for the event stream.
  Last, it opens a real `@shuri/client` subscription to `posts` against the port just served and,
  once the stream is open, inserts a post through the SDK: the frame it logs is the SSE path end to
  end, from the `afterChange` hook feeding the stream to the client's parser reading it.
- **collections.ts** / **globals.ts** — plain `CollectionSchema[]`/`GlobalSchema[]` literals (`as
const satisfies`) showing the field types available (`text`, `textarea`, `email`, `boolean`), the
  `access` rules above and one schema-declared hook.

## Role in the monorepo

Proof that `@shuri/sdk` and `@shuri/client` work end to end on a real (if minimal) HTTP server.
Useful as a template for wiring the toolkit into any other engine.

It is also the only consumer of `@shuri/ui`: `server.ts` mounts the admin at `/admin` through
`handlers` — as a **function**, so the admin can be handed the `AuthApi` that same call builds — and
authorizes one seeded account by email, since `@shuri/auth`'s `users` declares no role field. Any
other account (signup is open) reaches the admin and is told it has no access. Writes to
`/collections` and `/globals` are refused without that session; **reads stay public**, which is
`@shuri/ui`'s default and what makes the API still headless.

`pnpm --filter @shuri/demo start:better-auth` runs **better-auth-server.ts** instead: the same
collections, globals and admin, with `@shuri/better-auth` swapped in for `@shuri/auth`. It seeds no
account and carries no password in source — the first visit shows the setup form, and whoever
completes it becomes the administrator. Set `SHURI_SETUP_TOKEN` to gate that form.
