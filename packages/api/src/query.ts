import type { Query } from "@shuri/store";
import { arrayOf, object, oneOf, optional, record, refine, validate, type Validator } from "@shuri/validate";
import { InvalidQueryError } from "./errors.js";

const FILTER_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"] as const;
const SORT_DIRECTIONS = ["asc", "desc"] as const;

const filterOpValidator: Validator<unknown> = (value, ctx) => {
  if (typeof value !== "object" || value === null) {
    ctx.addIssue('must be a filter object with "op" and "value"');
    return;
  }
  const filter = value as { op?: unknown; value?: unknown };
  oneOf(FILTER_OPS, `"op" must be one of ${FILTER_OPS.join(", ")}`)(filter.op as (typeof FILTER_OPS)[number], ctx.at("op"));
  if (filter.op === "in" && !Array.isArray(filter.value)) {
    ctx.at("value").addIssue('"in" filter value must be an array');
  }
};

const orderByEntryValidator: Validator<unknown> = (value, ctx) => {
  if (typeof value !== "object" || value === null) {
    ctx.addIssue('must be an object with "field"');
    return;
  }
  const entry = value as { field?: unknown; direction?: unknown };
  if (typeof entry.field !== "string" || entry.field === "") ctx.at("field").addIssue('"field" is required');
  if (entry.direction !== undefined) {
    oneOf(SORT_DIRECTIONS, `"direction" must be one of ${SORT_DIRECTIONS.join(", ")}`)(
      entry.direction as (typeof SORT_DIRECTIONS)[number],
      ctx.at("direction"),
    );
  }
};

const nonNegativeInteger = (label: string): Validator<number> =>
  refine((value) => Number.isInteger(value) && value >= 0, `"${label}" must be a non-negative integer`);

interface RawQuery {
  limit?: number;
  offset?: number;
  where?: unknown;
  orderBy?: unknown;
}

const queryValidator: Validator<RawQuery> = object<RawQuery>({
  limit: optional(nonNegativeInteger("limit")),
  offset: optional(nonNegativeInteger("offset")),
  where: optional(record(filterOpValidator, '"where" must be an object of field filters')),
  orderBy: optional(arrayOf(orderByEntryValidator, '"orderBy" must be an array of order entries')),
});

function parseJsonParam(searchParams: URLSearchParams, param: string): unknown {
  const raw = searchParams.get(param);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidQueryError([{ path: `query.${param}`, message: "must be valid JSON" }]);
  }
}

function parseNumberParam(searchParams: URLSearchParams, param: string): number | undefined {
  const raw = searchParams.get(param);
  return raw === null ? undefined : Number(raw);
}

/**
 * Reads the engine-agnostic `Query` AST off URL search params (`limit`, `offset` as numbers;
 * `where`, `orderBy` as JSON-encoded strings), validated against its shape via `@shuri/validate`
 * the same way `@shuri/core` validates collection records - schema first, no hand-rolled checks.
 * Throws `InvalidQueryError` for anything malformed, so a bad query never reaches the adapter.
 */
export function parseQuery(searchParams: URLSearchParams): Query {
  const raw: RawQuery = {
    limit: parseNumberParam(searchParams, "limit"),
    offset: parseNumberParam(searchParams, "offset"),
    where: parseJsonParam(searchParams, "where"),
    orderBy: parseJsonParam(searchParams, "orderBy"),
  };

  const issues = validate(raw, queryValidator, "query");
  if (issues.length > 0) throw new InvalidQueryError(issues);

  return raw as Query;
}
