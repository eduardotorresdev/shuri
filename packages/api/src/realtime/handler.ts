import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { Store } from "@shuri/store";
import { MethodNotAllowedError } from "../errors.js";
import { eventStreamResponse, toErrorResponse } from "../utils/response.js";
import { matchesSelection } from "./filter.js";
import { toEventFrame } from "./frame.js";
import { parseEventQuery, type EventSelection } from "./query.js";
import { matchRealtimeRoute } from "./routes.js";

/**
 * Minimal shape `createRealtimeHandler` needs: the bus to stream from, plus the slug resolvers used
 * to reject a selection naming a collection/global that doesn't exist. `ShuriApp`'s own store
 * satisfies this structurally.
 */
export interface RealtimeApp<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> {
  store: Pick<Store<T, G>, "collection" | "global" | "events">;
}

export interface CreateRealtimeHandlerOptions {
  /** Path the event stream is mounted at. Defaults to "/events". */
  basePath?: string;
  /** Milliseconds between keep-alive comments on an idle stream. `0` disables them. Defaults to 15000. */
  heartbeatMs?: number;
}

/**
 * Probes every selected slug through the store's own resolvers, whose `UnknownCollectionError`/
 * `UnknownGlobalError` map to a 404 like everywhere else in this package. Without it a typo
 * (`?collection=nope`) would open a perfectly valid stream that stays empty forever — the hardest
 * possible failure to debug.
 * @param store - The store resolving each declared slug.
 * @param selection - The client's selection, as parsed from the query string.
 * @returns Nothing; throws if a selected slug isn't declared.
 */
function assertKnownSlugs<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(store: RealtimeApp<T, G>["store"], selection: EventSelection): void {
  for (const slug of selection.collection ?? []) store.collection(slug as never);
  for (const slug of selection.global ?? []) store.global(slug as never);
}

/**
 * Builds a web-standard `fetch` handler serving every event of `app.store` as one Server-Sent
 * Events stream at `basePath`:
 *
 *   GET {basePath}?collection=posts&global=site&id=abc&events=create,update
 *
 * One parameterized endpoint rather than a route per resource: a browser caps HTTP/1.1 connections
 * per origin at around six, so a CMS UI watching a handful of resources needs the filtering to
 * happen server-side, over a single connection. No params streams everything.
 *
 * Returns `undefined` for anything outside `basePath`, so it composes with the other handlers by
 * falling through (see `@shuri/sdk`'s `create()`), same as `globals/handler.ts` and `docs/handler.ts`.
 * @param app - The `{ store }` whose events are streamed.
 * @param [options] - Options controlling the handler, e.g. `basePath`/`heartbeatMs`.
 * @returns A handler serving the event stream, `undefined` for other requests.
 */
export function createRealtimeHandler<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(
  app: RealtimeApp<T, G>,
  options: CreateRealtimeHandlerOptions = {},
): (request: Request) => Promise<Response | undefined> {
  const basePath = options.basePath ?? "/events";

  return async function handleRequest(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (!matchRealtimeRoute(url.pathname, basePath)) return undefined;

    try {
      if (request.method !== "GET") throw new MethodNotAllowedError(request.method);

      const selection = parseEventQuery(url.searchParams);
      assertKnownSlugs(app.store, selection);

      // `StoreEventBus.subscribe` already returns the unsubscribe function, which is exactly the
      // teardown `eventStreamResponse` expects: a disconnect unsubscribes, with no glue in between.
      return eventStreamResponse(
        (send) =>
          app.store.events.subscribe((event) => {
            if (matchesSelection(event, selection)) send(toEventFrame(event));
          }),
        { signal: request.signal, heartbeatMs: options.heartbeatMs },
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
