import type { CollectionSchema } from "@shuri/core";
import {
  RecordNotFoundError,
  UnknownCollectionError,
  type CollectionStore,
  type CollectionSubscribe,
  type RecordId,
  type RecordInput,
  type Store,
  type StoreRecord,
} from "@shuri/store";

/** Test-only fixtures shared by this package's collection unit tests, kept independent of `@shuri/sdk`/`@shuri/store-memory`. */
export const servicesSchema: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [{ type: "text", name: "name", required: true }],
};

// A no-op arrow with no parameters satisfies both of `CollectionSubscribe`'s call signatures.
const noopSubscribe: CollectionSubscribe<RecordInput> = () => () => {};

/**
 * In-memory `CollectionStore` test double bound to `schema`, which it carries like a real one so the
 * `visibility/` layer can read its `hidden`/`internal` flags off it.
 * @param [schema] - The schema the fake store is bound to.
 * @returns A fake `CollectionStore` over an in-memory map.
 */
export function createFakeCollectionStore(
  schema: CollectionSchema = servicesSchema,
): CollectionStore<RecordInput> {
  const records = new Map<RecordId, StoreRecord>();
  let nextId = 1;

  return {
    schema,
    subscribe: noopSubscribe,
    async findMany() {
      return [...records.values()];
    },
    async findOne(id) {
      return records.get(id);
    },
    async get(id) {
      const record = records.get(id);
      if (!record) throw new RecordNotFoundError(schema.slug, id);
      return record;
    },
    async count() {
      return records.size;
    },
    async insert(data) {
      const record: StoreRecord = { ...data, id: String(nextId++) };
      records.set(record.id, record);
      return record;
    },
    async update(id, data) {
      const existing = records.get(id);
      if (!existing) throw new RecordNotFoundError(schema.slug, id);
      const updated: StoreRecord = { ...existing, ...data, id };
      records.set(id, updated);
      return updated;
    },
    async delete(id) {
      records.delete(id);
    },
  };
}

/**
 * Fake `{ store }` exposing the given collection stores, keyed by their own schema slug — so a test
 * can register a collection declaring `hidden` fields or `internal: true` and exercise the
 * visibility layer against it. Defaults to a single "services" collection.
 * @param [collections] - The collection stores to expose, resolved by their schema slug.
 * @returns A fake `{ store }` resolving each given collection by slug.
 */
export function createFakeApp(...collections: CollectionStore<RecordInput>[]): {
  store: Store;
} {
  const bySlug = new Map(
    (collections.length > 0 ? collections : [createFakeCollectionStore()]).map(
      (collection) => [collection.schema.slug, collection],
    ),
  );
  const store = {
    collection: (slug: string) => {
      const collection = bySlug.get(slug);
      if (!collection) throw new UnknownCollectionError(slug);
      return collection;
    },
  } as unknown as Store;
  return { store };
}
