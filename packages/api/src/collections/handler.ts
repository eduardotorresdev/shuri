import type { CollectionSchema } from "@shuri/core";
import type { Store } from "@shuri/store";
import { MethodNotAllowedError } from "../errors.js";
import { readJsonBody } from "../utils/request.js";
import { jsonResponse, noContentResponse, toErrorResponse } from "../utils/response.js";
import { UnknownRouteError } from "./errors.js";
import { parseQuery } from "./query.js";
import { servableCollection } from "../visibility/internal.js";
import {
  publicCollection,
  type PublicCollection,
} from "../visibility/public-collection.js";
import { matchCollectionRoute } from "./routes.js";

/**
 * Minimal shape `createApiHandler` needs. `ShuriApp` from `@shuri/sdk` satisfies this structurally,
 * so this package's sole dependency is `@shuri/store`, keeping `@shuri/sdk`/`@shuri/core` out of the
 * picture. `store.collection(slug)` is the app's own collection resolver (throwing
 * `UnknownCollectionError` for an undeclared slug); this handler reuses that lookup as-is.
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
 * A collection declared `internal` isn't served at all: the request 404s exactly as it would for a
 * slug no collection declares (see `visibility/internal.ts`), and a field declared `hidden` never
 * appears in a response and can't be written or queried (see `visibility/public-collection.ts`).
 *
 * Record validation happens in `@shuri/store`'s `insert`/`update`, which already guard every write
 * against the collection's declared fields (so does `@shuri/sdk`, since both go through the same
 * `CollectionStore`), throwing `RecordValidationError` on a bad body. This handler's job is to
 * translate that (via `response.ts#toErrorResponse`) into a 400 response.
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

      // `servableCollection` is what applies `internal`, and `publicCollection` what applies
      // `hidden`: from here down, no unredacted view of the collection exists to forget about.
      const collection = publicCollection(servableCollection(app.store, route.slug));
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
  collection: PublicCollection,
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
  collection: PublicCollection,
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
