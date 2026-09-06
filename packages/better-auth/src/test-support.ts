import type { CollectionSchema } from "@shuri/core";
import type {
  Query,
  RecordId,
  RecordInput,
  StoreAdapter,
  StoreRecord,
} from "@shuri/store";

/** One write the app's adapter was asked to perform. */
export interface RecordedWrite {
  op: "insert" | "update" | "delete";
  slug: string;
}

export interface RecordingAdapter {
  adapter: StoreAdapter;
  writes: RecordedWrite[];
  /** Every row the adapter holds for a slug, read straight out of the underlying store. */
  rows(slug: string): Promise<StoreRecord[]>;
}

/**
 * Wraps a `StoreAdapter` and records every write, so a test can assert **where** a row landed rather
 * than only that some API call succeeded.
 *
 * That is the whole claim this package makes: better-auth's tables live in the app's own store, on
 * the app's own adapter. Nothing short of watching the adapter proves it.
 * @param inner - The adapter to wrap, normally `createMemoryAdapter()`.
 * @returns The wrapping adapter, the recorded writes, and a way to read rows back.
 */
export function recordingAdapter(inner: StoreAdapter): RecordingAdapter {
  const writes: RecordedWrite[] = [];

  const adapter: StoreAdapter = {
    ...inner,
    insert(collection: CollectionSchema, data: RecordInput) {
      writes.push({ op: "insert", slug: collection.slug });
      return inner.insert(collection, data);
    },
    update(collection: CollectionSchema, id: RecordId, data: Partial<RecordInput>) {
      writes.push({ op: "update", slug: collection.slug });
      return inner.update(collection, id, data);
    },
    delete(collection: CollectionSchema, id: RecordId) {
      writes.push({ op: "delete", slug: collection.slug });
      return inner.delete(collection, id);
    },
  };

  return {
    adapter,
    writes,
    rows: (slug: string) =>
      inner.findMany({ slug, fields: [] } as unknown as CollectionSchema, {} as Query),
  };
}
