import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { GlobalStore, RecordInput, Store } from "@shuri/store";
import { MethodNotAllowedError } from "../errors.js";
import { readJsonBody } from "../utils/request.js";
import { jsonResponse, toErrorResponse } from "../utils/response.js";
import { matchGlobalRoute } from "./routes.js";

/**
 * Minimal shape `createGlobalsApiHandler` needs. `ShuriApp` from `@shuri/sdk` satisfies this
 * structurally, so this package depends only on `@shuri/store`, not on `@shuri/sdk`/`@shuri/core`.
 */
export interface GlobalsApiApp<G extends readonly GlobalSchema[] = GlobalSchema[]> {
  store: Pick<Store<CollectionSchema[], G>, "global">;
}

export interface CreateGlobalsApiHandlerOptions {
  /** Path prefix global routes are mounted under. Defaults to "/globals". */
  basePath?: string;
}

/**
 * Builds a web-standard `fetch` handler that exposes every global declared on `app.store` as a
 * single-record REST resource under `basePath`:
 *
 *   GET   {basePath}/:slug   read the global's record
 *   PATCH {basePath}/:slug   update it (merge)
 *
 * Returns `undefined` for anything outside `basePath`, so it composes with `createApiHandler` and
 * `createOpenApiHandler` by falling through (see `@shuri/sdk`'s `create()`).
 * @param app - The `{ store }` exposing every global to serve.
 * @param [options] - Options controlling the handler, e.g. `basePath`.
 * @returns A framework-agnostic HTTP handler serving `app`'s globals, `undefined` for other requests.
 */
export function createGlobalsApiHandler<G extends readonly GlobalSchema[]>(
  app: GlobalsApiApp<G>,
  options: CreateGlobalsApiHandlerOptions = {},
): (request: Request) => Promise<Response | undefined> {
  const basePath = options.basePath ?? "/globals";

  return async function handleRequest(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    const route = matchGlobalRoute(url.pathname, basePath);
    if (!route) return undefined;

    try {
      const global = app.store.global(route.slug as never) as GlobalStore<RecordInput>;

      switch (request.method) {
        case "GET":
          return jsonResponse(await global.get());
        case "PATCH":
          return jsonResponse(await global.update(await readJsonBody(request)));
        default:
          throw new MethodNotAllowedError(request.method);
      }
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
