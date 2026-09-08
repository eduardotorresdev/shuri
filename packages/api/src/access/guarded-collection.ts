import {
  authorizeCollection,
  type AccessContext,
  type CollectionAccessOp,
  type CollectionSchema,
  type Where,
} from "@shuri/core";
import {
  matchesWhere,
  mergeWhere,
  RecordNotFoundError,
  type RecordId,
  type RecordInput,
} from "@shuri/store";
import type { PublicCollection } from "../visibility/public-collection.js";
import { deny } from "./principal.js";

/**
 * Wraps a `PublicCollection` so every operation is authorized first, per the policy in
 * `@shuri/core`'s `access/policy.ts`, and a rule's `Where` is honored:
 *
 * - `findMany` ANDs it into the client's own `where` (`mergeWhere`), so pagination still counts
 *   only the rows the caller may see;
 * - `get`/`update`/`delete` read the record and check it against the `Where`, answering the very
 *   same `RecordNotFoundError` an unknown id does — a row the caller may not see must look exactly
 *   like a row that doesn't exist. For `update`, it's the **pre-image** that is checked, like
 *   Payload: what the rule rules on is the record as it is, not as the caller would like it.
 *
 * Wraps *outside* `publicCollection` on purpose: a 401/403 is decided before the 400 a `hidden`
 * field in the body would earn, so an anonymous caller can't learn hidden field names by probing.
 * The flip side is that a rule's `Where` can't name a `hidden` field: `publicCollection` refuses
 * such a query (400 on list) and hands back redacted records (no match on get), both failing closed.
 * @param collection - The public view to guard.
 * @param schema - The collection's schema, for its slug and `access` map.
 * @param base - The request's base context (principal, request), extended per operation.
 * @returns The guarded view, same interface.
 */
export function guardedCollection(
  collection: PublicCollection,
  schema: Pick<CollectionSchema, "slug" | "access">,
  base: AccessContext,
): PublicCollection {
  async function allow(
    op: CollectionAccessOp,
    extra: Pick<AccessContext, "id" | "data"> = {},
  ): Promise<Where | undefined> {
    const result = await authorizeCollection(schema, op, { ...base, ...extra });
    if (result === false) deny(base.principal);
    return result === true ? undefined : result;
  }

  async function visible(id: RecordId, where: Where | undefined): Promise<RecordInput> {
    const record = await collection.get(id);
    if (where && !matchesWhere(record, where)) {
      throw new RecordNotFoundError(schema.slug, id);
    }
    return record;
  }

  return {
    async findMany(query) {
      const where = await allow("list");
      if (!where) return collection.findMany(query);
      return collection.findMany({ ...query, where: mergeWhere(query?.where, where) });
    },
    async get(id) {
      const where = await allow("view", { id });
      return visible(id, where) as ReturnType<PublicCollection["get"]>;
    },
    async insert(data) {
      await allow("create", { data });
      return collection.insert(data);
    },
    async update(id, data) {
      const where = await allow("update", { id, data });
      if (where) await visible(id, where);
      return collection.update(id, data);
    },
    async delete(id) {
      const where = await allow("delete", { id });
      if (where) await visible(id, where);
      return collection.delete(id);
    },
  };
}
