/**
 * The engine-agnostic filter/sort/pagination AST adapters translate into their own native query
 * language. Declared in `@shuri/core` (an access rule answers with a `Where`, and core can't import
 * this package) and re-exported here, so every adapter and consumer keeps importing it from the store.
 */
export type { FilterOp, OrderBy, Query, SortDirection, Where } from "@shuri/core";
