import { redactRecord, type CollectionSchema, type GlobalSchema } from "@shuri/core";
import {
  UnknownCollectionError,
  UnknownGlobalError,
  type Store,
  type StoreEvent,
} from "@shuri/store";

/**
 * The HTTP-facing view of one store event: `undefined` when it must not be streamed at all (an
 * `internal` collection, or a slug the store no longer resolves), otherwise the event with every
 * `hidden` field stripped from its record.
 *
 * One function returning one thing, rather than a "should I send this?" predicate plus a "redact
 * this" mapper: a two-part contract can be applied half-way, and half-applied here means streaming
 * a password hash to every connected client.
 * @param store - The store resolving each slug's schema.
 * @param event - The event as published on the bus.
 * @returns The event to stream, or `undefined` when it must not be streamed.
 */
export function publicEvent<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(
  store: Pick<Store<T, G>, "collection" | "global">,
  event: StoreEvent,
): StoreEvent | undefined {
  try {
    if (event.scope === "collection") {
      const { schema } = store.collection(event.collection as never);
      if (schema.internal) return undefined;
      if (event.type === "delete") return event;
      return { ...event, record: redactRecord(schema, event.record) };
    }

    const { schema } = store.global(event.global as never);
    return { ...event, record: redactRecord(schema, event.record) };
  } catch (error) {
    // A slug the store can't resolve can't be checked for visibility either, so it isn't streamed.
    // Nothing on the bus should reach here today; failing closed keeps it that way if something does.
    if (error instanceof UnknownCollectionError || error instanceof UnknownGlobalError)
      return undefined;
    throw error;
  }
}
