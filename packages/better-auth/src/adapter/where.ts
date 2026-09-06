import type { CleanedWhere } from "better-auth/adapters";
import type { FilterOp, Query, Where } from "@shuri/store";

/**
 * The better-auth operators that map onto a `@shuri/store` `FilterOp` one-for-one. The rest —
 * `not_in`, `starts_with`, `ends_with` — have no equivalent in the store's `Query` AST and are
 * evaluated here instead.
 */
const PUSHABLE: Readonly<Record<string, FilterOp["op"] | undefined>> = {
  eq: "eq",
  ne: "ne",
  lt: "lt",
  lte: "lte",
  gt: "gt",
  gte: "gte",
  in: "in",
  contains: "contains",
};

/**
 * Whether a whole clause list can be handed to the store as one `Query.where`.
 *
 * `Query.where` is a `Record<field, FilterOp>` — a conjunction of exactly one operator per field.
 * That rules out three things: an `OR` connector, two clauses on the same field, and any operator
 * the store has no name for. Case-insensitive matching is out too, since the store compares exactly.
 *
 * When any of those appear, **nothing** is pushed down: narrowing by a subset would be wrong for an
 * `OR` (a row excluded by the pushed-down filter might still satisfy the disjunction), and getting
 * that wrong silently returns too few rows rather than failing.
 * @param where - The clauses better-auth is asking for.
 * @returns Whether the store can evaluate them all.
 */
export function isPushable(where: readonly CleanedWhere[]): boolean {
  const fields = new Set<string>();

  for (const clause of where) {
    if (clause.connector === "OR") return false;
    if (clause.mode === "insensitive") return false;
    if (PUSHABLE[clause.operator] === undefined) return false;
    if (fields.has(clause.field)) return false;
    fields.add(clause.field);
  }
  return true;
}

/**
 * Translates a pushable clause list into the store's `where`. Call `isPushable` first.
 * @param where - The clauses to translate.
 * @returns The store's filter, one entry per field.
 */
export function toStoreWhere(where: readonly CleanedWhere[]): Where {
  const filter: Where = {};

  for (const clause of where) {
    const op = PUSHABLE[clause.operator];
    if (op === undefined) continue;
    filter[clause.field] =
      op === "in"
        ? { op, value: Array.isArray(clause.value) ? [...clause.value] : [clause.value] }
        : ({ op, value: clause.value } as FilterOp);
  }
  return filter;
}

/**
 * Builds the store query for a read, pushing the filter down only when the store can evaluate it in
 * full.
 *
 * `limit`/`offset` ride along **only** with a pushed-down filter. Paginating a set the store
 * filtered differently from what better-auth asked for would return the wrong page, so an
 * unpushable read takes the whole collection and slices after filtering here.
 * @param where - The clauses better-auth is asking for.
 * @param [page] - The `limit`/`offset` to apply, when the caller has any.
 * @returns The query to run, and whether the result still needs filtering in memory.
 */
export function toStoreQuery(
  where: readonly CleanedWhere[],
  page?: { limit?: number; offset?: number },
): { query: Query; filtered: boolean } {
  if (!isPushable(where)) return { query: {}, filtered: false };

  const query: Query = {};
  if (where.length > 0) query.where = toStoreWhere(where);
  if (page?.limit !== undefined) query.limit = page.limit;
  if (page?.offset !== undefined) query.offset = page.offset;
  return { query, filtered: true };
}
