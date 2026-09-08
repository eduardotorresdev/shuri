/**
 * Engine-agnostic filter/sort/pagination AST that `@shuri/store` adapters translate into their own
 * native query language (SQL, an ORM's builder, etc.). Declared here rather than in `@shuri/store`
 * because an access rule (`access/`) answers with a `Where`, and this package can't import the store.
 */
export type FilterOp =
  | { op: "eq"; value: unknown }
  | { op: "ne"; value: unknown }
  | { op: "gt"; value: unknown }
  | { op: "gte"; value: unknown }
  | { op: "lt"; value: unknown }
  | { op: "lte"; value: unknown }
  | { op: "in"; value: unknown[] }
  | { op: "contains"; value: string };

/**
 * One filter per field, or several ANDed together on the same field. The array form is what lets a
 * client's own `where` and an access rule's `Where` be merged without either one winning: both
 * constraints on `author` are kept, and a record must satisfy every one of them.
 */
export type Where = Record<string, FilterOp | FilterOp[]>;

export type SortDirection = "asc" | "desc";

export interface OrderBy {
  field: string;
  direction?: SortDirection;
}

export interface Query {
  where?: Where;
  orderBy?: OrderBy[];
  limit?: number;
  offset?: number;
}
