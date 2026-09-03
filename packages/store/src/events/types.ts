import type { RecordId, RecordInput, StoreRecord } from "../record.js";

export const STORE_EVENT_TYPES = ["create", "update", "delete"] as const;

export type StoreEventType = (typeof STORE_EVENT_TYPES)[number];

/**
 * Every event carries two discriminants. `scope` ("collection"/"global") tells apart which kind of
 * resource changed, and is what the bus's consumers dispatch on; `type` ("create"/"update"/
 * "delete") tells what happened to it, and is what a listener usually branches on. Neither is
 * serialized as-is over the wire: `@shuri/api` turns `type` into the SSE `event:` line and keeps
 * `scope` server-side, as a filter.
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
 * Carries only the id: `delete` hands the id straight to the adapter, so emitting the deleted record
 * would mean an extra read before every delete, for a pre-image nothing has asked for yet.
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

/** Everything that can happen to one record: whoever already holds its id can't be told of its creation. */
export type RecordEvent<R = RecordInput> =
  CollectionUpdateEvent<R> | CollectionDeleteEvent;

export type GlobalEvent<R = RecordInput> = GlobalUpdateEvent<R>;

export type StoreEvent = CollectionEvent | GlobalEvent;

export type StoreEventListener<E> = (event: E) => void;

export type Unsubscribe = () => void;
