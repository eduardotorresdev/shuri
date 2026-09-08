import type { Query, WithId } from "@shuri/core";
import type { Http } from "./http.js";
import { toSearchParams } from "./query.js";
import {
  subscribe,
  type EventType,
  type RealtimeMessage,
  type SubscribeOptions,
  type Unsubscribe,
} from "./realtime/subscribe.js";

/** A frame of one collection's stream; a `delete` carries the id only. */
export type CollectionEvent<R> =
  | { type: "create" | "update"; collection: string; id: string; record: WithId<R> }
  | { type: "delete"; collection: string; id: string };

export interface CollectionSubscribeOptions extends SubscribeOptions {
  /** Only these event types; every type by default. */
  events?: EventType[];
  /** Only one record's updates and deletes. */
  id?: string;
}

/** The REST surface of one collection, typed from its fields, plus its slice of the event stream. */
export interface CollectionClient<R> {
  list(query?: Query): Promise<WithId<R>[]>;
  get(id: string): Promise<WithId<R>>;
  create(data: R): Promise<WithId<R>>;
  update(id: string, patch: Partial<R>): Promise<WithId<R>>;
  delete(id: string): Promise<void>;
  subscribe(
    listener: (event: CollectionEvent<R>) => void,
    options?: CollectionSubscribeOptions,
  ): Unsubscribe;
}

/**
 * Binds one collection's routes (`{collections}/:slug[/:id]`) and stream selection to `http`.
 * @param http - The HTTP seam.
 * @param paths - The collections and events base paths.
 * @param slug - The collection's slug.
 * @returns The typed client for `slug`.
 */
export function collectionClient<R>(
  http: Http,
  paths: { collections: string; events: string },
  slug: string,
): CollectionClient<R> {
  const base = `${paths.collections}/${encodeURIComponent(slug)}`;
  const record = (id: string) => `${base}/${encodeURIComponent(id)}`;

  return {
    list: (query) => http.json("GET", base, { query: toSearchParams(query) }),
    get: (id) => http.json("GET", record(id)),
    create: (data) => http.json("POST", base, { body: data }),
    update: (id, patch) => http.json("PATCH", record(id), { body: patch }),
    delete: (id) => http.json("DELETE", record(id)),
    subscribe(listener, { events, id, ...options } = {}) {
      return subscribe(
        http,
        paths.events,
        {
          collection: [slug],
          ...(id ? { id: [id] } : {}),
          ...(events ? { events } : {}),
        },
        (message: RealtimeMessage) => listener(message as unknown as CollectionEvent<R>),
        options,
      );
    },
  };
}
