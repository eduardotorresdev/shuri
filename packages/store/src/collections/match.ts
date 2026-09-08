import type { FilterOp, Where } from "@shuri/core";
import type { RecordInput } from "../record.js";

/**
 * Orders two values of the same primitive type; unordered or mismatched types compare as equal.
 * The one ordering every in-process consumer of the AST shares — the memory adapter's sort, and
 * the range filters below.
 * @param a - The first value to compare.
 * @param b - The second value to compare.
 * @returns A negative number if `a` sorts before `b`, positive if after, zero if equal.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return 0;
}

/**
 * Evaluates one filter against one value, in memory. `eq`/`ne` are strict `===`, so they never fall
 * into `compareValues`'s "equal" answer for an unsupported type.
 * @param value - The record's value for the filtered field.
 * @param filter - The filter to evaluate.
 * @returns Whether `value` satisfies `filter`.
 */
export function matchesFilter(value: unknown, filter: FilterOp): boolean {
  switch (filter.op) {
    case "eq":
      return value === filter.value;
    case "ne":
      return value !== filter.value;
    case "gt":
      return compareValues(value, filter.value) > 0;
    case "gte":
      return compareValues(value, filter.value) >= 0;
    case "lt":
      return compareValues(value, filter.value) < 0;
    case "lte":
      return compareValues(value, filter.value) <= 0;
    case "in":
      return filter.value.includes(value);
    case "contains":
      return typeof value === "string" && value.includes(filter.value);
  }
}

/**
 * Evaluates a whole `Where` against one record, in memory: every field's filter (or every filter of
 * a field's array) must hold. The reference semantics of the AST, which is why it lives here rather
 * than in one adapter: the memory adapter filters with it, and `@shuri/api` checks an access rule's
 * `Where` against a single record with it.
 * @param record - The record to test.
 * @param where - The filters to satisfy.
 * @returns Whether `record` satisfies every filter of `where`.
 */
export function matchesWhere(record: RecordInput, where: Where): boolean {
  return Object.entries(where).every(([field, filters]) =>
    (Array.isArray(filters) ? filters : [filters]).every((filter) =>
      matchesFilter(record[field], filter),
    ),
  );
}

function toList(filters: FilterOp | FilterOp[] | undefined): FilterOp[] {
  if (filters === undefined) return [];
  return Array.isArray(filters) ? filters : [filters];
}

/**
 * ANDs two `Where`s field by field: a field constrained by both keeps every filter of both. Neither
 * side can override the other, which is what makes it safe to merge a client's query with an access
 * rule's restriction — the rule's `author eq me` survives whatever `where` the client sent.
 * @param a - The first `Where`, or `undefined` for none.
 * @param b - The second `Where`, or `undefined` for none.
 * @returns The merged `Where`.
 */
export function mergeWhere(a: Where | undefined, b: Where | undefined): Where {
  const merged: Where = {};
  for (const field of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const filters = [...toList(a?.[field]), ...toList(b?.[field])];
    merged[field] = filters.length === 1 ? filters[0] : filters;
  }
  return merged;
}
