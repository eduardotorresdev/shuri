import type { CollectionSchema } from "@shuri/core";
import type { CollectionStore, RecordInput, Store } from "@shuri/store";
import { MethodNotAllowedError } from "../errors.js";
import { readJsonBody } from "../utils/request.js";
import { jsonResponse, noContentResponse, toErrorResponse } from "../utils/response.js";
import { UnknownRouteError } from "./errors.js";
import { parseQuery } from "./query.js";
import { matchCollectionRoute } from "./routes.js";

/**
 * Minimal shape `createApiHandler` needs. `ShuriApp` from `@shuri/sdk` satisfies this structurally,
 * so this package depends only on `@shuri/store`, not on `@shuri/sdk`/`@shuri/core` themselves.
 * `store.collection(slug)` is the app's own collection resolver (throwing `UnknownCollectionError`
 * for an undeclared slug) — this handler doesn't reimplement that lookup.
 */
export interface ApiApp<T extends readonly CollectionSchema[] = CollectionSchema[]> {
  store: Pick<Store<T>, "collection">;
}

export interface CreateApiHandlerOptions {
  /** Path prefix collection routes are mounted under. Defaults to "/collections". */
  basePath?: string;
}

/**
 * Builds a web-standard `fetch` handler that exposes every collection declared on `app.store` as a
 * REST resource under `basePath`:
 *
 *   GET    {basePath}/:slug       list (query: limit, offset, where, orderBy - where/orderBy as JSON)
 *   POST   {basePath}/:slug       insert
 *   GET    {basePath}/:slug/:id   get one
 *   PATCH  {basePath}/:slug/:id   update
 *   DELETE {basePath}/:slug/:id   delete
 *
 * Framework-agnostic by design: it only touches `Request`/`Response`, so Deno/Bun can serve it
 * directly, Hono can forward `c.req.raw` to it, and a thin per-engine adapter covers the rest.
 *
 * This layer does not validate records itself: `@shuri/store`'s `insert`/`update` already guard
 * every write against the collection's declared fields (so does `@shuri/sdk`, since both go
 * through the same `CollectionStore`), throwing `RecordValidationError` on a bad body. This
 * handler's job is only to translate that (via `response.ts#toErrorResponse`) into a 400 response.
 * @param app - The `{ store }` exposing every collection to serve.
 * @param [options] - Options controlling the handler, e.g. `basePath`.
 * @returns A framework-agnostic HTTP handler serving `app`'s collections.
 */
export function createApiHandler<T extends readonly CollectionSchema[]>(
  app: ApiApp<T>,
  options: CreateApiHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const basePath = options.basePath ?? "/collections";

  return async function handleRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const route = matchCollectionRoute(url.pathname, basePath);
      if (!route) throw new UnknownRouteError();

      const collection = app.store.collection(
        route.slug as never,
      ) as CollectionStore<RecordInput>;
      return await (route.id
        ? handleRecord(request, collection, route.id)
        : handleCollection(request, collection, url));
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

async function handleCollection(
  request: Request,
  collection: CollectionStore<RecordInput>,
  url: URL,
): Promise<Response> {
  switch (request.method) {
    case "GET":
      return jsonResponse(await collection.findMany(parseQuery(url.searchParams)));
    case "POST":
      return jsonResponse(await collection.insert(await readJsonBody(request)), {
        status: 201,
      });
    default:
      throw new MethodNotAllowedError(request.method);
  }
}

async function handleRecord(
  request: Request,
  collection: CollectionStore<RecordInput>,
  id: string,
): Promise<Response> {
  switch (request.method) {
    case "GET":
      return jsonResponse(await collection.get(id));
    case "PATCH":
      return jsonResponse(await collection.update(id, await readJsonBody(request)));
    case "DELETE":
      await collection.delete(id);
      return noContentResponse();
    default:
      throw new MethodNotAllowedError(request.method);
  }
}
