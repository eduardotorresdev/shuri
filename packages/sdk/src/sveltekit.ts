import type { ShuriApp } from "./create.js";

/** The slice of SvelteKit's `RequestEvent` this adapter needs — just enough to route without SvelteKit as a dependency. */
export interface SvelteKitRequestEvent {
  request: Request;
  url: URL;
}

/** Structurally matches SvelteKit's `Handle` input, so `toSvelteKitHandle(app)` slots straight into `export const handle`. */
export interface SvelteKitHandleInput<Event extends SvelteKitRequestEvent = SvelteKitRequestEvent> {
  event: Event;
  resolve: (event: Event) => Response | Promise<Response>;
}

export interface ToSvelteKitHandleOptions {
  /** Path prefix routed to `app.handler`; everything else falls through to `resolve`. Defaults to `/api`. */
  base?: string;
}

/**
 * Wraps `app.handler` as a SvelteKit `Handle`, so `hooks.server.ts` only needs:
 *
 *   export const handle = toSvelteKitHandle(app);
 *
 * Requests under `options.base` (default `/api`) go to `app.handler`; everything else — pages, other
 * endpoints — falls through to `resolve` untouched. `app.handler` already speaks `Request`/`Response`
 * natively, so this is routing glue only, not a protocol bridge like the Node adapter needs.
 * @param app - The app whose `handler` serves matching requests.
 * @param options - `base`, the path prefix routed to `app.handler`.
 * @returns A SvelteKit-`Handle`-shaped function.
 */
export function toSvelteKitHandle<Event extends SvelteKitRequestEvent = SvelteKitRequestEvent>(
  app: Pick<ShuriApp, "handler">,
  options: ToSvelteKitHandleOptions = {},
): (input: SvelteKitHandleInput<Event>) => Response | Promise<Response> {
  const base = options.base ?? "/api";
  return ({ event, resolve }) =>
    event.url.pathname === base || event.url.pathname.startsWith(`${base}/`)
      ? app.handler(event.request)
      : resolve(event);
}
