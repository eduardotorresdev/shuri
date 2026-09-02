/**
 * Engine-agnostic filter/sort/pagination AST. Adapters translate this into their own
 * native query language (SQL, an ORM's builder, etc.) instead of accepting raw queries.
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

export type Where = Record<string, FilterOp>;

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
