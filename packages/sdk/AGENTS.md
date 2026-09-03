# @shuri/sdk

The facade tying schema (`@shuri/core`) + persistence adapter (`@shuri/store`) + HTTP handlers
(`@shuri/api`) into a single app via `create()`: `app.collections.<slug>`, `app.globals.<slug>`,
`app.handler`. This is the package most consumers should import from directly.

## Tree

```
src/
  index.ts                    re-exports create.js
  create.ts                    create(), ShuriApp, CreateConfig, AppCollections/AppGlobals
  create.test.ts               unit tests for create()
  test/
    handler.test.ts             integration test exercising app.handler end to end
```

## What each part does

- **create.ts** — `create({ collections, globals, adapter, api?, globalsApi?, openapi? })`:
  1. Calls `createCore` (`@shuri/core`) to validate the declared schema.
  2. Calls `createStore` (`@shuri/store`) to bind that `Core` to `adapter`.
  3. Builds `app.collections`/`app.globals`: one typed `CollectionStore`/`GlobalStore` per declared
     slug, so `app.collections.posts.insert(...)` and `app.globals.site.get()` are typed from the
     schema with no manual typing.
  4. Builds `app.handler` by chaining `createOpenApiHandler` -> `createGlobalsApiHandler` ->
     `createApiHandler` (`@shuri/api`), each falling through (`undefined`) to the next until one
     handles the request.

## Role in the monorepo

The single entry point meant for end users of the toolkit (`@shuri/demo` is the reference consumer).
Everything below it (`core`, `store`, `api`) is composable on its own, but `sdk` is what wires them
together with sensible defaults.
