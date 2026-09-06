import type { RecordInput, StoreRecord } from "@shuri/store";

export interface SortBy {
  field: string;
  direction: "asc" | "desc";
}

/**
 * Orders records the way better-auth's own adapter does: nulls first, strings by `localeCompare`,
 * numbers and booleans by value, anything else by its string form.
 *
 * Used only for a read this package could not push down to the store — a pushed-down read is ordered
 * by the adapter, which is both faster and the only correct choice once `limit`/`offset` are in play.
 * @param records - The records to order. Sorted in place, as they are this function's own array.
 * @param sortBy - The field and direction to order by.
 * @returns The same array, ordered.
 */
export function sortRecords<R extends RecordInput>(
  records: StoreRecord<R>[],
  sortBy: SortBy,
): StoreRecord<R>[] {
  const sign = sortBy.direction === "desc" ? -1 : 1;

  // oxlint-disable-next-line unicorn/no-array-sort -- `records` is the caller's own fresh array
  return records.sort((left, right) => {
    const a = (left as RecordInput)[sortBy.field];
    const b = (right as RecordInput)[sortBy.field];

    if (a === b) return 0;
    if (a === undefined || a === null) return -sign;
    if (b === undefined || b === null) return sign;

    if (typeof a === "string" && typeof b === "string") return a.localeCompare(b) * sign;
    if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
    if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : -1) * sign;
    return String(a).localeCompare(String(b)) * sign;
  });
}
