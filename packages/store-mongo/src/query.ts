import type { FilterOp, Query, Where } from "@shuri/core";
import type { Document, Filter, Sort } from "mongodb";
import { pathOf, type StoredDocument } from "./document.js";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Translates one `FilterOp` of the `@shuri/store` AST into the equivalent MongoDB operator
 * expression for a single field.
 * @param filter - The filter to translate.
 * @returns The MongoDB expression that matches the same values.
 */
export function toMongoFilter(filter: FilterOp): Document {
  switch (filter.op) {
    case "eq":
      return { $eq: filter.value };
    case "ne":
      return { $ne: filter.value };
    case "gt":
      return { $gt: filter.value };
    case "gte":
      return { $gte: filter.value };
    case "lt":
      return { $lt: filter.value };
    case "lte":
      return { $lte: filter.value };
    case "in":
      return { $in: filter.value };
    case "contains":
      return { $regex: escapeRegex(filter.value) };
  }
}

/**
 * Translates a `Where` into a MongoDB filter document. Every field's filters are ANDed together
 * (a field can carry more than one), which is why they land in a `$and` list rather than merged
 * into a single object: two `eq` filters on the same field must both hold, not overwrite each other.
 * The `id` field is mapped to `_id`, where records keep their id.
 * @param where - The engine-agnostic filters, or `undefined` for none.
 * @returns The equivalent MongoDB filter (an empty document matches everything).
 */
export function toMongoWhere(where: Where | undefined): Filter<StoredDocument> {
  if (!where) return {};
  const clauses: Document[] = [];
  for (const [field, filters] of Object.entries(where)) {
    for (const filter of Array.isArray(filters) ? filters : [filters]) {
      clauses.push({ [pathOf(field)]: toMongoFilter(filter) });
    }
  }
  return clauses.length === 0 ? {} : { $and: clauses };
}

/**
 * Translates a `Query`'s `orderBy` into a MongoDB sort specification, keeping the field order.
 * @param query - The query whose ordering to translate.
 * @returns The sort document, or `undefined` when the query is unordered.
 */
export function toMongoSort(query: Query | undefined): Sort | undefined {
  if (!query?.orderBy?.length) return undefined;
  return Object.fromEntries(
    query.orderBy.map(({ field, direction = "asc" }) => [
      pathOf(field),
      direction === "asc" ? 1 : -1,
    ]),
  );
}
