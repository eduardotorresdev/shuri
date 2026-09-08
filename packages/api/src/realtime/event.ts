import type { RecordId, RecordInput, StoreRecord } from "@shuri/store";

/** The wire vocabulary of the event stream: what the `event:` line of an SSE frame may carry. */
export const STORE_EVENT_TYPES = ["create", "update", "delete"] as const;

export type StoreEventType = (typeof STORE_EVENT_TYPES)[number];

/**
 * Every event carries two discriminants. `scope` ("collection"/"global") tells apart which kind of
 * resource changed, and is what the stream's filters dispatch on; `type` ("create"/"update"/
 * "delete") tells what happened to it, and is what a client branches on. Neither is serialized
 * as-is: `frame.ts` turns `type` into the SSE `event:` line and keeps `scope` server-side.
 *
 * These events are built from the store's `afterChange`/`afterDelete` hooks (see `source.ts`); they
 * exist only for this route, which is why they live here rather than in `@shuri/store`.
 */
export interface CollectionCreateEvent<R = RecordInput> {
  scope: "collection";
  type: "create";
  collection: string;
  id: RecordId;
  record: StoreRecord<R>;
}

export interface CollectionUpdateEvent<R = RecordInput> {
  scope: "collection";
  type: "update";
  collection: string;
  id: RecordId;
  record: StoreRecord<R>;
}

/**
 * Carries only the id, not the pre-image: a client holding a copy of the record can drop it by id,
 * and streaming a deleted record's content would hand it to a connection whose access rule can no
 * longer be checked against a row that no longer exists.
 */
export interface CollectionDeleteEvent {
  scope: "collection";
  type: "delete";
  collection: string;
  id: RecordId;
}

export interface GlobalUpdateEvent<R = RecordInput> {
  scope: "global";
  type: "update";
  global: string;
  record: R;
}

/**
 * Everything that can happen to one collection. Reading `event.record` requires narrowing by `type`
 * first (`if (event.type === "delete") return;`), since a delete event carries no record.
 */
export type CollectionEvent<R = RecordInput> =
  CollectionCreateEvent<R> | CollectionUpdateEvent<R> | CollectionDeleteEvent;

export type GlobalEvent<R = RecordInput> = GlobalUpdateEvent<R>;

export type StoreEvent = CollectionEvent | GlobalEvent;
