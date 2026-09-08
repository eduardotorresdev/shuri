import { randomUUID } from "node:crypto";
import type { CollectionSchema } from "@shuri/core";
import { RecordNotFoundError, type StoreAdapter } from "@shuri/store";
import type { Collection, Db } from "mongodb";
import { bodyOf, fieldsOf, toRecord, type StoredDocument } from "./document.js";
import { toMongoSort, toMongoWhere } from "./query.js";

export interface MongoAdapterOptions {
  /** A connected `Db` from the `mongodb` driver. The caller owns the client and its lifecycle. */
  db: Db;
  /**
   * Name of the MongoDB collection that holds every global, one document per slug.
   * @default "_globals"
   */
  globalsCollection?: string;
}

/**
 * MongoDB implementation of `StoreAdapter`. Each `CollectionSchema` maps to the MongoDB collection
 * of the same slug; record ids are UUID strings stored as `_id`. Globals share one collection,
 * keyed by the global's slug. Requires MongoDB 5.0+, where an empty `$set` is a no-op rather than
 * an error, so an empty update payload needs no special casing.
 * @param options - The database handle and optional naming.
 * @returns A `StoreAdapter` backed by MongoDB.
 */
export function createMongoAdapter(options: MongoAdapterOptions): StoreAdapter {
  const { db, globalsCollection = "_globals" } = options;
  const ensured = new Map<string, Promise<void>>();

  /**
   * Creates the indexes a collection declares (`index: true` fields), once per collection per
   * adapter, on the first operation that touches it. `createIndex` is idempotent on the server,
   * so a restart costs one round trip per collection and nothing more. A failure forgets the
   * attempt, so the next operation retries instead of running unindexed for the process's life.
   * @param collection - The collection about to be read or written.
   * @returns Resolves once the indexes exist.
   */
  function indexed(collection: CollectionSchema): Promise<void> {
    let pending = ensured.get(collection.slug);
    if (!pending) {
      const target = db.collection<StoredDocument>(collection.slug);
      pending = Promise.all(
        collection.fields
          .filter((field) => field.index)
          .map((field) => target.createIndex({ [field.name]: 1 })),
      ).then(() => undefined);
      pending.catch(() => ensured.delete(collection.slug));
      ensured.set(collection.slug, pending);
    }
    return pending;
  }

  async function collectionFor(
    collection: CollectionSchema,
  ): Promise<Collection<StoredDocument>> {
    await indexed(collection);
    return db.collection<StoredDocument>(collection.slug);
  }
  const globals = db.collection<StoredDocument>(globalsCollection);

  return {
    async findMany(collection, query) {
      // Mongo reads `limit: 0` as "no limit"; the AST means "nothing".
      if (query?.limit === 0) return [];
      const documents = await (
        await collectionFor(collection)
      )
        .find(toMongoWhere(query?.where), {
          sort: toMongoSort(query),
          skip: query?.offset,
          limit: query?.limit,
        })
        .toArray();
      return documents.map(toRecord);
    },
    async findOne(collection, id) {
      const document = await (await collectionFor(collection)).findOne({ _id: id });
      return document ? toRecord(document) : undefined;
    },
    async count(collection, query) {
      if (query?.limit === 0) return 0;
      return (await collectionFor(collection)).countDocuments(
        toMongoWhere(query?.where),
        {
          skip: query?.offset,
          limit: query?.limit,
        },
      );
    },
    async insert(collection, data) {
      const document: StoredDocument = { ...bodyOf(data), _id: randomUUID() };
      await (await collectionFor(collection)).insertOne(document);
      return toRecord(document);
    },
    async update(collection, id, data) {
      const updated = await (
        await collectionFor(collection)
      ).findOneAndUpdate(
        { _id: id },
        { $set: bodyOf(data) },
        { returnDocument: "after" },
      );
      if (!updated) throw new RecordNotFoundError(collection.slug, id);
      return toRecord(updated);
    },
    async delete(collection, id) {
      await (await collectionFor(collection)).deleteOne({ _id: id });
    },
    async findGlobal(global) {
      const document = await globals.findOne({ _id: global.slug });
      return document ? fieldsOf(document) : undefined;
    },
    async updateGlobal(global, data) {
      const updated = await globals.findOneAndUpdate(
        { _id: global.slug },
        { $set: bodyOf(data) },
        { upsert: true, returnDocument: "after" },
      );
      // An upsert with `returnDocument: "after"` always yields a document; the driver just types it as nullable.
      return fieldsOf(updated ?? { _id: global.slug });
    },
  };
}
