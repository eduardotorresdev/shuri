import type { CollectionSchema, OperationContext } from "@shuri/core";
import type { StoreAdapter } from "../adapter.js";
import type { HookRegistry } from "../hooks/registry.js";
import { collectionHooksFor } from "../hooks/resolve.js";
import { runAfterHooks, runBeforeHooks } from "../hooks/run.js";
import type { RecordId, RecordInput, StoreRecord } from "../record.js";
import { assertValidRecord } from "../validate-record.js";
import { RecordNotFoundError } from "./errors.js";
import type { Query } from "./query.js";

/**
 * Persistence operations scoped to a single collection. Every operation runs the collection's
 * hooks (schema-declared, then registered) around the adapter call; the optional trailing
 * `context` is what those hooks see as `context` — `@shuri/api` passes the request and principal,
 * a direct call passes nothing.
 *
 * **This store is the complete view.** It carries `schema` — `hidden` fields and `internal`
 * collections included — and never applies either flag: both are HTTP-surface metadata, applied by
 * `@shuri/api`'s `visibility/` layer. A hidden field is readable and writable from here, and an
 * internal collection behaves exactly like any other.
 */
export interface CollectionStore<R = RecordInput> {
  /**
   * The schema this store was bound to, so the HTTP layer can read visibility metadata off the
   * store it was handed. Mandatory rather than optional: an optional property would let a caller
   * that forgot it serve a hidden field with no error at all.
   */
  readonly schema: CollectionSchema;
  /** `beforeRead(list)` may replace the query; `afterRead` runs once per record returned. */
  findMany(query?: Query, context?: OperationContext): Promise<StoreRecord<R>[]>;
  /** `beforeRead(get)`, then `afterRead` for the record — skipped when nothing was found. */
  findOne(id: RecordId, context?: OperationContext): Promise<StoreRecord<R> | undefined>;
  /** Throws `RecordNotFoundError` when the record doesn't exist, like `findOne` returns `undefined`. */
  get(id: RecordId, context?: OperationContext): Promise<StoreRecord<R>>;
  /** Runs no hooks. */
  count(query?: Query): Promise<number>;
  /** `beforeValidate` → field validation → `beforeChange` → adapter → `afterChange(create)`. */
  insert(data: R, context?: OperationContext): Promise<StoreRecord<R>>;
  /**
   * Reads the pre-image first (throwing `RecordNotFoundError` when there is none), then
   * `beforeValidate` → partial field validation → `beforeChange` → adapter → `afterChange(update)`,
   * the last one carrying the pre-image as `previousDoc`.
   */
  update(
    id: RecordId,
    data: Partial<R>,
    context?: OperationContext,
  ): Promise<StoreRecord<R>>;
  /**
   * Reads the pre-image (which may not exist), then `beforeDelete` → adapter → `afterDelete`. A
   * delete of an id that never existed is still accepted, as the adapter accepts it: the hooks then
   * run with `doc` undefined, meaning "a delete was accepted", not "a record stopped existing".
   */
  delete(id: RecordId, context?: OperationContext): Promise<void>;
}

/**
 * Binds one collection's CRUD to `adapter`, running the collection's hooks around every call. A
 * _before_ hook that throws aborts the operation before the adapter is touched; an _after_ hook
 * that throws propagates to the caller, the write already done. Every hook has run by the time the
 * caller's `await` resolves.
 * @param collection - The schema of the collection being bound.
 * @param adapter - The persistence adapter backing the collection.
 * @param registry - The registry of programmatically registered hooks.
 * @returns The `CollectionStore` for `collection`.
 */
export function bindCollection(
  collection: CollectionSchema,
  adapter: StoreAdapter,
  registry: HookRegistry,
): CollectionStore {
  const slug = collection.slug;
  const hooks = <N extends Parameters<typeof collectionHooksFor>[2]>(name: N) =>
    collectionHooksFor(collection, registry, name);

  async function afterRead(
    doc: StoreRecord,
    operation: "list" | "get",
    context: OperationContext,
    query?: Query,
  ): Promise<StoreRecord> {
    return runBeforeHooks(
      hooks("afterRead"),
      { collection: slug, context, operation, doc, query },
      "doc",
    );
  }

  async function findOne(
    id: RecordId,
    context: OperationContext = {},
  ): Promise<StoreRecord | undefined> {
    await runAfterHooks(hooks("beforeRead"), {
      collection: slug,
      context,
      operation: "get",
      id,
    });
    const record = await adapter.findOne(collection, id);
    return record && afterRead(record, "get", context);
  }

  return {
    schema: collection,
    async findMany(query, context = {}) {
      const finalQuery = await runBeforeHooks(
        hooks("beforeRead"),
        { collection: slug, context, operation: "list", query },
        "query",
      );
      const records = await adapter.findMany(collection, finalQuery);
      const result: StoreRecord[] = [];
      for (const record of records) {
        result.push(await afterRead(record, "list", context, finalQuery));
      }
      return result;
    },
    findOne,
    async get(id, context) {
      const record = await findOne(id, context);
      if (!record) throw new RecordNotFoundError(slug, id);
      return record;
    },
    count: (query) => adapter.count(collection, query),
    async insert(input, context = {}) {
      const validated = await runBeforeHooks(
        hooks("beforeValidate"),
        { collection: slug, context, operation: "create", data: input },
        "data",
      );
      assertValidRecord(collection, validated);
      const data = await runBeforeHooks(
        hooks("beforeChange"),
        { collection: slug, context, operation: "create", data: validated },
        "data",
      );
      const doc = await adapter.insert(collection, data);
      await runAfterHooks(hooks("afterChange"), {
        collection: slug,
        context,
        operation: "create",
        doc,
      });
      return doc;
    },
    async update(id, input, context = {}) {
      const originalDoc = await adapter.findOne(collection, id);
      if (!originalDoc) throw new RecordNotFoundError(slug, id);

      const validated = await runBeforeHooks(
        hooks("beforeValidate"),
        { collection: slug, context, operation: "update", data: input, originalDoc, id },
        "data",
      );
      assertValidRecord(collection, validated, { partial: true });
      const data = await runBeforeHooks(
        hooks("beforeChange"),
        {
          collection: slug,
          context,
          operation: "update",
          data: validated,
          originalDoc,
          id,
        },
        "data",
      );
      const doc = await adapter.update(collection, id, data);
      await runAfterHooks(hooks("afterChange"), {
        collection: slug,
        context,
        operation: "update",
        doc,
        previousDoc: originalDoc,
      });
      return doc;
    },
    async delete(id, context = {}) {
      const doc = await adapter.findOne(collection, id);
      await runAfterHooks(hooks("beforeDelete"), { collection: slug, context, id, doc });
      await adapter.delete(collection, id);
      await runAfterHooks(hooks("afterDelete"), { collection: slug, context, id, doc });
    },
  };
}
