import type { CleanedWhere } from "better-auth/adapters";
import type { RecordInput } from "@shuri/store";

/**
 * Case-insensitive equality, for a clause asking for `mode: "insensitive"`. Non-strings fall back to
 * `===`, since there is no case to ignore.
 * @param a - The stored value.
 * @param b - The value the clause is looking for.
 * @returns Whether the two are equal, ignoring case for strings.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Evaluates one clause against a record, mirroring better-auth's own in-memory adapter so a query
 * this package cannot push down still answers identically to one it can.
 * @param record - The stored record.
 * @param clause - The clause to evaluate.
 * @returns Whether `record` satisfies `clause`.
 */
function matchesClause(record: RecordInput, clause: CleanedWhere): boolean {
  const actual = record[clause.field];
  const { value, mode } = clause;
  const insensitive = mode === "insensitive";

  switch (clause.operator) {
    case "in":
    case "not_in": {
      const values = Array.isArray(value) ? (value as unknown[]) : [value];
      const hit = insensitive
        ? values.some((entry) => looseEquals(actual, entry))
        : values.includes(actual);
      return clause.operator === "in" ? hit : !hit;
    }
    case "contains":
    case "starts_with":
    case "ends_with": {
      const haystack = asString(actual);
      const needle = asString(value);
      if (haystack === undefined || needle === undefined) return false;
      const [a, b] = insensitive
        ? [haystack.toLowerCase(), needle.toLowerCase()]
        : [haystack, needle];
      if (clause.operator === "contains") return a.includes(b);
      return clause.operator === "starts_with" ? a.startsWith(b) : a.endsWith(b);
    }
    case "ne":
      return insensitive ? !looseEquals(actual, value) : actual !== value;
    // `null` never orders against anything: comparing it would coerce to 0 and match rows the
    // caller did not ask for.
    case "gt":
      return value !== null && actual !== null && (actual as never) > (value as never);
    case "gte":
      return value !== null && actual !== null && (actual as never) >= (value as never);
    case "lt":
      return value !== null && actual !== null && (actual as never) < (value as never);
    case "lte":
      return value !== null && actual !== null && (actual as never) <= (value as never);
    default:
      if (insensitive) return looseEquals(actual, value);
      // `== null` on purpose: an absent field and a stored `null` are the same absence to
      // better-auth, which asks for `null` to mean either.
      if (value === null) return actual === undefined || actual === null;
      return actual === value;
  }
}

/**
 * Evaluates a whole clause list against a record.
 *
 * The fold is better-auth's, quirks included: it seeds the result with the **first** clause and then
 * folds over every clause again, so clause 0 is evaluated twice and each clause's own `connector`
 * decides how it joins what came before. For the all-`AND` lists better-auth actually emits this is
 * a plain conjunction; reproducing the fold rather than tidying it is what keeps an unpushable query
 * answering the same as better-auth's own adapter would.
 * @param record - The stored record.
 * @param where - The clauses to evaluate.
 * @returns Whether `record` satisfies `where`.
 */
export function matchesWhere(
  record: RecordInput,
  where: readonly CleanedWhere[],
): boolean {
  if (where.length === 0) return true;

  let result = matchesClause(record, where[0] as CleanedWhere);
  for (const clause of where) {
    const hit = matchesClause(record, clause);
    result = clause.connector === "OR" ? result || hit : result && hit;
  }
  return result;
}
