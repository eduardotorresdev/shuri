# @shuri/api

Web-standard (`Request`/`Response`) HTTP handlers that expose collections and globals as REST, plus
the OpenAPI document and docs page. Framework-agnostic: runs directly on Deno/Bun or behind a thin
adapter (Node, Hono, ...). Depends solely on `@shuri/store` and `@shuri/validate`, keeping
`@shuri/core`/`@shuri/sdk` out of the picture so it stays decoupled from schema authoring.

## Tree

```
src/
  index.ts                    re-exports everything below
  errors.ts                    ApiError base, MethodNotAllowedError, InvalidJsonBodyError
  utils/
    request.ts                  readJsonBody: parses the request body, throws InvalidJsonBodyError
    response.ts                  jsonResponse/errorResponse/noContentResponse/toErrorResponse
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
  docs/
    openapi.ts                   buildOpenApiDocument: assembles the full OpenAPI 3.1 document
    json-schema.ts               fieldSchema/collectionSchema/globalSchema (Field -> JSON Schema)
    paths.ts                     collectionPaths/globalPaths (OpenAPI path items)
    handler.ts                   createOpenApiHandler: serves /openapi.json and /docs (Scalar)
```

## What each part does

- **collections/handler.ts** — `createApiHandler` mounts `GET/POST {basePath}/:slug` and
  `GET/PATCH/DELETE {basePath}/:slug/:id` on top of a `Store`. Record validation already happens
  inside `CollectionStore.insert`/`update` (`@shuri/store`); this layer's job is only to translate
  thrown errors into HTTP responses via `toErrorResponse`.
- **collections/query.ts** — turns URL search params into the `@shuri/store` `Query` AST, validated
  through `@shuri/validate` combinators, the same way `@shuri/core` validates schema.
- **globals/handler.ts** — `createGlobalsApiHandler` mounts `GET/PATCH {basePath}/:slug`; returns
  `undefined` for anything outside `basePath` so it composes by falling through (see `@shuri/sdk`'s
  `create()`), same as `docs/handler.ts`.
- **docs/openapi.ts** / **docs/json-schema.ts** / **docs/paths.ts** — pure, HTTP-free functions that
  build the OpenAPI 3.1 document mirroring the routes above exactly (one path pair per collection,
  one per global, plus a `components.schemas` entry derived from each schema's fields).
- **utils/response.ts#toErrorResponse** — the single place that maps known errors (from
  `@shuri/store` and this package) to HTTP status codes; unrecognized errors are rethrown to surface
  as a 500 (or crash) at the hosting engine's own error boundary.

## Role in the monorepo

`@shuri/sdk`'s `create()` composes `createApiHandler` + `createGlobalsApiHandler` +
`createOpenApiHandler` into `app.handler`. `@shuri/demo` reaches this package only indirectly,
through `@shuri/sdk`.
