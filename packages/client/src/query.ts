import type { Query } from "@shuri/core";

/**
 * Serializes a `Query` the way `@shuri/api`'s `parseQuery` reads it: `limit`/`offset` as plain
 * numbers, `where`/`orderBy` as JSON. An absent key is left out rather than sent empty.
 * @param query - The query to serialize.
 * @returns The search params to append to the list URL.
 */
export function toSearchParams(query: Query = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.where !== undefined) params.set("where", JSON.stringify(query.where));
  if (query.orderBy !== undefined) params.set("orderBy", JSON.stringify(query.orderBy));
  return params;
}
