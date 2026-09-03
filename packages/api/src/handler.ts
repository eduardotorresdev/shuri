import type { CollectionSchema, Core, GlobalSchema } from "@shuri/core";
import type { Store } from "@shuri/store";
import { createApiHandler, type CreateApiHandlerOptions } from "./collections/handler.js";
import {
  createOpenApiHandler,
  type CreateOpenApiHandlerOptions,
} from "./docs/handler.js";
import {
  createGlobalsApiHandler,
  type CreateGlobalsApiHandlerOptions,
} from "./globals/handler.js";
import {
  createRealtimeHandler,
  type CreateRealtimeHandlerOptions,
} from "./realtime/handler.js";

/** Everything the composed handler serves from: the declared schema and the store backing it. */
export interface HandlerApp<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> {
  core: Core<T, G>;
  store: Store<T, G>;
}

export interface CreateHandlerOptions {
  /** Options for the collections REST routes. See `createApiHandler`. */
  api?: CreateApiHandlerOptions;
  /** Options for the globals REST routes. See `createGlobalsApiHandler`. */
  globalsApi?: CreateGlobalsApiHandlerOptions;
  /** Options for the event stream. See `createRealtimeHandler`. */
  realtime?: CreateRealtimeHandlerOptions;
  /** Options for the OpenAPI document and docs page. See `createOpenApiHandler`. */
  openapi?: CreateOpenApiHandlerOptions;
}

/**
 * Composes this package's four handlers into the single `fetch` handler serving an app's whole HTTP
 * surface: the OpenAPI document and docs page, the event stream, the globals routes and the
 * collections routes.
 *
 * The order is exact-path matchers first, prefix matchers next, terminal handler last: `openapi` and
 * `realtime` each match one path, `globals`/`collections` match everything under their base path,
 * and `createApiHandler` answers 404 rather than falling through. With the default base paths
 * nothing collides, but all four are configurable, so the order is what breaks the tie.
 *
 * Each base path is also forwarded to the OpenAPI document (unless `openapi` overrides it), so the
 * document always describes the routes actually being served.
 * @param app - The `{ core, store }` to serve.
 * @param [options] - Per-handler options, e.g. `api.basePath`/`realtime.heartbeatMs`.
 * @returns The composed HTTP handler.
 */
export function createHandler<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(
  app: HandlerApp<T, G>,
  options: CreateHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const falling = [
    createOpenApiHandler(app, {
      basePath: options.api?.basePath,
      globalsBasePath: options.globalsApi?.basePath,
      realtimeBasePath: options.realtime?.basePath,
      ...options.openapi,
    }),
    createRealtimeHandler(app, options.realtime),
    createGlobalsApiHandler(app, options.globalsApi),
  ];
  const terminal = createApiHandler(app, options.api);

  return async function handleRequest(request: Request): Promise<Response> {
    for (const handler of falling) {
      const response = await handler(request);
      if (response) return response;
    }
    return terminal(request);
  };
}
