import type { CollectionSchema, Core } from "@shuri/core";
import { buildOpenApiDocument, type BuildOpenApiDocumentOptions, type OpenApiDocument } from "./openapi.js";

/** Minimal shape `createOpenApiHandler` needs — just enough to enumerate every declared collection. */
export interface OpenApiApp<T extends readonly CollectionSchema[] = CollectionSchema[]> {
  core: Core<T>;
}

export interface CreateOpenApiHandlerOptions extends BuildOpenApiDocumentOptions {
  /** Path the OpenAPI document is served at. Defaults to "/openapi.json". */
  specPath?: string;
  /** Path the docs page (Scalar API Reference) is served at. Defaults to "/docs". */
  docsPath?: string;
}

function docsHtml(specPath: string, title: string): string {
  return `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="${specPath}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
`;
}

/**
 * Builds a web-standard `fetch` handler that serves the OpenAPI document for every collection
 * declared on `app.core` (see `openapi.ts#buildOpenApiDocument`) plus a docs page rendering it via
 * Scalar's API Reference. `specPath`/`docsPath` should be outside `basePath` so they never collide
 * with `createApiHandler`'s collection routes. Returns `undefined` for any other request, so it
 * composes with `createApiHandler` by falling through (see `@shuri/sdk`'s `create()`).
 * @param app - The `{ core }` holding the declared collections to describe.
 * @param [options] - Options controlling the handler, e.g. `specPath`/`docsPath`/`title`.
 * @returns A handler serving the OpenAPI document and docs page, `undefined` otherwise.
 */
export function createOpenApiHandler<T extends readonly CollectionSchema[]>(
  app: OpenApiApp<T>,
  options: CreateOpenApiHandlerOptions = {},
): (request: Request) => Promise<Response | undefined> {
  const specPath = options.specPath ?? "/openapi.json";
  const docsPath = options.docsPath ?? "/docs";
  const title = options.title ?? "Shuri API";

  let document: OpenApiDocument | undefined;
  function getDocument(): OpenApiDocument {
    document ??= buildOpenApiDocument(app.core.collections, options);
    return document;
  }

  return async function handleRequest(request: Request): Promise<Response | undefined> {
    const { pathname } = new URL(request.url);
    if (request.method !== "GET") return undefined;

    if (pathname === specPath) {
      return new Response(JSON.stringify(getDocument()), { headers: { "content-type": "application/json" } });
    }
    if (pathname === docsPath) {
      return new Response(docsHtml(specPath, title), { headers: { "content-type": "text/html" } });
    }
    return undefined;
  };
}
