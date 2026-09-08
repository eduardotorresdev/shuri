import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { Store } from "@shuri/store";
import { createEventGate, type EventGate } from "../access/event-gate.js";
import { resolveAccessContext, type AccessOptions } from "../access/principal.js";
import { MethodNotAllowedError } from "../errors.js";
import { eventStreamResponse, toErrorResponse } from "../utils/response.js";
import { matchesSelection } from "./filter.js";
import { toEventFrame } from "./frame.js";
import { parseEventQuery, type EventSelection } from "./query.js";
import { subscribeToChanges } from "./source.js";
import { servableCollection } from "../visibility/internal.js";
import { publicEvent } from "../visibility/public-event.js";
import { matchRealtimeRoute } from "./routes.js";

/**
 * Minimal shape `createRealtimeHandler` needs: the hook registry the stream is fed from, plus the
 * slug resolvers used to reject a selection naming a collection/global that doesn't exist. `ShuriApp`'s own store
 * satisfies this structurally.
 */
export interface RealtimeApp<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> {
  store: Pick<Store<T, G>, "collection" | "global" | "hooks">;
}

export interface CreateRealtimeHandlerOptions {
  /** Path the event stream is mounted at. Defaults to "/events". */
  basePath?: string;
  /** Milliseconds between keep-alive comments on an idle stream. `0` disables them. Defaults to 15000. */
  heartbeatMs?: number;
  /** Turns the `access` rules on: `list` (collections) / `read` (globals) gate each event. See `access/`. */
  access?: AccessOptions;
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
  // Through `servableCollection`, so selecting an `internal` collection 404s exactly like selecting
  // one that was never declared.
  for (const slug of selection.collection ?? []) servableCollection(store, slug);
  for (const slug of selection.global ?? []) store.global(slug as never);
}

/**
 * Builds a web-standard `fetch` handler serving every write to `app.store` — observed through its
 * `afterChange`/`afterDelete` hooks, see `source.ts` — as one Server-Sent Events stream at
 * `basePath`:
 *
 *   GET {basePath}?collection=posts&global=site&id=abc&events=create,update
 *
 * One parameterized endpoint rather than a route per resource: a browser caps HTTP/1.1 connections
 * per origin at around six, so a CMS UI watching a handful of resources needs the filtering to
 * happen server-side, over a single connection. No params streams everything.
 *
 * Events of a collection declared `internal` never reach the stream, and a field declared `hidden`
 * is stripped from every frame (see `visibility/public-event.ts`). With `options.access`, an
 * explicit selection the principal may not read is refused up front, and every event is gated by
 * the `list`/`read` rule of its slug (see `access/event-gate.ts`).
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

      let gate: EventGate | undefined;
      if (options.access) {
        gate = createEventGate(
          app.store,
          await resolveAccessContext(options.access, request),
        );
        await gate.assertSelectable(selection);
      }

      // `subscribeToChanges` returns the unsubscribe function, which is exactly the teardown
      // `eventStreamResponse` expects: a disconnect unregisters the hooks, with no glue in between.
      return eventStreamResponse((send) => subscribe(app.store, selection, gate, send), {
        signal: request.signal,
        heartbeatMs: options.heartbeatMs,
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/**
 * Subscribes one connection to the store's writes. Without a gate, each event is sent synchronously.
 * With one, admission is async (a rule may await the store) while delivery is synchronous, so
 * decisions are chained on a promise: order is preserved, and a rule that throws drops that one
 * event and resurfaces the error out of band — the same fail-closed stance `source.ts` takes for a
 * listener.
 * @param store - The store whose hooks feed the connection.
 * @param selection - The client's selection.
 * @param gate - The connection's access gate, when access control is on.
 * @param send - Writes one frame to the stream.
 * @returns The unsubscribe function.
 */
function subscribe<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(
  store: RealtimeApp<T, G>["store"],
  selection: EventSelection,
  gate: EventGate | undefined,
  send: (frame: string) => void,
): () => void {
  let chain: Promise<void> = Promise.resolve();

  return subscribeToChanges(store.hooks, (rawEvent) => {
    // `publicEvent` first, and it returns one thing: an event of an `internal` collection is
    // dropped and a `hidden` field stripped in a single step there's no way to half-apply.
    const event = publicEvent(store, rawEvent);
    if (!event || !matchesSelection(event, selection)) return;
    if (!gate) {
      send(toEventFrame(event));
      return;
    }

    chain = chain
      .then(() => gate.admits(event))
      .then(
        (admitted) => {
          if (admitted) send(toEventFrame(event));
        },
        (error: unknown) => {
          queueMicrotask(() => {
            throw error;
          });
        },
      );
  });
}
