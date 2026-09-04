import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import {
  UnknownCollectionError,
  type CollectionStore,
  type RecordInput,
  type Store,
} from "@shuri/store";

/**
 * Resolves a collection that HTTP is allowed to serve, or throws.
 *
 * A collection declared `internal` throws the store's own `UnknownCollectionError` — the very same
 * class, message and resulting body an undeclared slug produces. That identity is the point: an
 * internal collection must be indistinguishable from one that was never declared, so probing
 * `/collections/_sessions` teaches nothing.
 * @param store - The store resolving each declared slug.
 * @param slug - The collection slug taken off the request path.
 * @returns The `CollectionStore` for `slug`.
 */
export function servableCollection<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(store: Pick<Store<T, G>, "collection">, slug: string): CollectionStore<RecordInput> {
  const collection = store.collection(slug as never) as CollectionStore<RecordInput>;
  if (collection.schema.internal) throw new UnknownCollectionError(slug);
  return collection;
}
