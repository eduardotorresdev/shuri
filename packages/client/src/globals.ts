import type { Http } from "./http.js";
import {
  subscribe,
  type RealtimeMessage,
  type SubscribeOptions,
  type Unsubscribe,
} from "./realtime/subscribe.js";

/** A frame of one global's stream: always an update, carrying the merged record. */
export interface GlobalEvent<R> {
  type: "update";
  global: string;
  record: R;
}

/** The REST surface of one global, typed from its fields, plus its slice of the event stream. */
export interface GlobalClient<R> {
  get(): Promise<R>;
  update(patch: Partial<R>): Promise<R>;
  subscribe(
    listener: (event: GlobalEvent<R>) => void,
    options?: SubscribeOptions,
  ): Unsubscribe;
}

/**
 * Binds one global's routes (`{globals}/:slug`) and stream selection to `http`.
 * @param http - The HTTP seam.
 * @param paths - The globals and events base paths.
 * @param slug - The global's slug.
 * @returns The typed client for `slug`.
 */
export function globalClient<R>(
  http: Http,
  paths: { globals: string; events: string },
  slug: string,
): GlobalClient<R> {
  const path = `${paths.globals}/${encodeURIComponent(slug)}`;

  return {
    get: () => http.json("GET", path),
    update: (patch) => http.json("PATCH", path, { body: patch }),
    subscribe: (listener, options) =>
      subscribe(
        http,
        paths.events,
        { global: [slug] },
        (message: RealtimeMessage) => listener(message as unknown as GlobalEvent<R>),
        options,
      ),
  };
}
