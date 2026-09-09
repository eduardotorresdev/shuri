import type { Field } from "@shuri/core";
import type { FilterOp, Where } from "@shuri/store";
import {
  object,
  oneOf,
  refine,
  required,
  validate,
  type Validator,
} from "@shuri/validate";
import type { AdminCollection } from "$shared/schema.js";
import { fieldLabel, formatCell, type RelationLabels } from "../fields/values.js";

/** Prefix of a field's filter param (`?f.title=...`), so a field named `sort` can't collide. */
const FILTER_PARAM = "f.";

/** Prefix of the form control carrying a field's operator, e.g. `op.readingMinutes`. */
const OP_PARAM = "op.";

/** The operators a list offers. `in` is left out: no control in the filter bar produces a list. */
export type FilterOpName = Exclude<FilterOp["op"], "in">;

/** One filter, as the URL carries it and as a control holds it. */
export interface ListFilter {
  op: FilterOpName;
  /**
   * The value as typed or picked, still text — that is what a URL and a form control both hold.
   * {@link toWhere} is the one place it takes the field's own type.
   */
  text: string;
}

/**
 * A list's filters, keyed by field name. At most one per field, because that is all `Where` can
 * express: it maps a field to a single `FilterOp`, so "between 10 and 20" is not offered.
 */
export type ListFilters = Readonly<Record<string, ListFilter>>;

const TEXT_OPS = ["contains"] as const;
const NUMBER_OPS = ["eq", "ne", "gt", "gte", "lt", "lte"] as const;
const EXACT_OPS = ["eq"] as const;

/** How an operator reads to an author, in a chip and in the operator select. */
export const OP_LABELS: Readonly<Record<FilterOpName, string>> = {
  contains: "contém",
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

/**
 * The operators offered for a field, the first being its default. Chosen per type rather than
 * offered in full: `contains` is the only comparison worth making on prose, while a number is
 * exactly where ranges matter. A multi-valued field gets none — its stored value is a list, and
 * every operator here compares against a single value, so a filter on one would match nothing.
 * @param field - The field to offer operators for.
 * @returns The operators, empty when the field cannot be filtered.
 */
export function filterOps(field: Field): readonly FilterOpName[] {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
      return TEXT_OPS;
    case "number":
      return NUMBER_OPS;
    case "boolean":
      return EXACT_OPS;
    case "select":
    case "relation":
      return field.multiple ? [] : EXACT_OPS;
  }
}

/**
 * The fields a collection's list offers a filter for, in declaration order. Unlike `listColumns`
 * there is no cap and `textarea` is kept: the filters live in a panel of their own, so a long
 * collection costs vertical space rather than an unreadable table, and searching a body for a word
 * is exactly what a `textarea` filter is for.
 * @param collection - The collection whose list is being drawn.
 * @returns The filterable fields.
 */
export function filterFields(collection: AdminCollection): readonly Field[] {
  return collection.fields.filter((field) => filterOps(field).length > 0);
}

/**
 * The rule a filter's text has to meet to stand for a value of `field`.
 * @param field - The field being filtered.
 * @returns The text's validator.
 */
function textValidator(field: Field): Validator<string> {
  if (field.type === "number") {
    return refine(
      (text) => text.trim() !== "" && Number.isFinite(Number(text)),
      "must be a number",
    );
  }
  if (field.type === "boolean") return oneOf(["true", "false"]);
  if (field.type === "select") return oneOf(field.options.map((it) => it.value));
  return required();
}

/**
 * Whether a filter is one this field can actually be queried with: an operator the field offers,
 * and text that stands for one of its values.
 *
 * The single gate every filter passes through, wherever it came from — a hand-edited URL, an empty
 * box, a select left on "todos". Anything that fails is dropped rather than sent: the store would
 * have answered a filter for `readingMinutes = "abc"` with an empty list, which an author reads as
 * "no records".
 * @param field - The field being filtered.
 * @param filter - The filter to check.
 * @returns Whether `filter` may be applied to `field`.
 */
export function isValidFilter(field: Field, filter: ListFilter): boolean {
  const validator = object<ListFilter>({
    op: oneOf(filterOps(field)),
    text: textValidator(field),
  });
  return validate(filter, validator).length === 0;
}

/**
 * Reads one filter out of its `op:value` encoding, splitting at the first colon only so that a
 * filtered-for value may contain colons of its own.
 * @param raw - The param's raw value.
 * @returns The filter, or `undefined` when `raw` carries no operator.
 */
function parseFilter(raw: string): ListFilter | undefined {
  const separator = raw.indexOf(":");
  if (separator === -1) return undefined;
  return {
    op: raw.slice(0, separator) as FilterOpName,
    text: raw.slice(separator + 1),
  };
}

/**
 * Reads the filters a URL carries: one param per field, spelling out its operator
 * (`?f.title=contains:svelte`), rather than the JSON `where` the REST route takes. The list's other
 * params — `sort`, `direction`, `offset` — are plain readable text too, and a filtered list is a
 * link meant to be shared and edited by hand.
 * @param fields - The collection's filterable fields.
 * @param params - The URL's search params.
 * @returns The filters that apply, with anything malformed left out.
 */
export function readFilters(
  fields: readonly Field[],
  params: URLSearchParams,
): ListFilters {
  const filters: Record<string, ListFilter> = {};

  for (const field of fields) {
    const raw = params.get(filterName(field));
    if (raw === null) continue;
    const filter = parseFilter(raw);
    if (filter && isValidFilter(field, filter)) filters[field.name] = filter;
  }

  return filters;
}

/**
 * Reads the filters a submitted filter form holds: a value control named `f.<field>` per field, and
 * an operator select named `op.<field>` where the field offers a choice of operator. A box left
 * empty fails {@link isValidFilter} and is absent from the result — clearing a filter is the same
 * gesture as never setting one.
 * @param fields - The collection's filterable fields.
 * @param data - The submitted form.
 * @returns The filters the author asked for.
 */
export function formFilters(fields: readonly Field[], data: FormData): ListFilters {
  const filters: Record<string, ListFilter> = {};

  for (const field of fields) {
    const text = data.get(filterName(field));
    if (typeof text !== "string") continue;

    const op = data.get(opName(field));
    const filter: ListFilter = {
      op: typeof op === "string" ? (op as FilterOpName) : filterOps(field)[0],
      text: text.trim(),
    };
    if (isValidFilter(field, filter)) filters[field.name] = filter;
  }

  return filters;
}

/**
 * The name of the control holding a field's filter value, and of the search param it lands in.
 * @param field - The field being filtered.
 * @returns The control's name.
 */
export function filterName(field: Field): string {
  return FILTER_PARAM + field.name;
}

/**
 * The name of the control holding a field's filter operator.
 * @param field - The field being filtered.
 * @returns The control's name.
 */
export function opName(field: Field): string {
  return OP_PARAM + field.name;
}

/**
 * The search params a set of filters translates to — one entry per filterable field, `undefined`
 * for the fields not being filtered. Every field is named, including those: the result is applied
 * to the URL the list is already on, so a field left out would keep the filter on screen instead of
 * dropping it.
 * @param fields - The collection's filterable fields.
 * @param filters - The filters to apply.
 * @returns The params to set, or to drop where the value is `undefined`.
 */
export function filterParams(
  fields: readonly Field[],
  filters: ListFilters,
): Record<string, string | undefined> {
  const changes: Record<string, string | undefined> = {};

  for (const field of fields) {
    const filter = filters[field.name];
    changes[filterName(field)] =
      filter && isValidFilter(field, filter) ? `${filter.op}:${filter.text}` : undefined;
  }

  return changes;
}

/**
 * The value a filter's text stands for, in the field's own type: the store compares against stored
 * values, so `10` has to be a number and `true` a boolean before the query is sent.
 * @param field - The field being filtered.
 * @param text - The filter's text.
 * @returns The typed value to query with.
 */
function filterValue(field: Field, text: string): unknown {
  if (field.type === "number") return Number(text);
  if (field.type === "boolean") return text === "true";
  return text;
}

/**
 * Turns a list's filters into the `Where` the REST list route takes.
 * @param fields - The collection's filterable fields.
 * @param filters - The filters on screen.
 * @returns The query's `where`, `undefined` when nothing is filtered — so an unfiltered list still
 * sends a bare URL.
 */
export function toWhere(
  fields: readonly Field[],
  filters: ListFilters,
): Where | undefined {
  const where: Where = {};

  for (const field of fields) {
    const filter = filters[field.name];
    if (!filter || !isValidFilter(field, filter)) continue;
    // `FilterOp` is a union discriminated by `op`, and an operator known only as "one of several"
    // doesn't narrow it. The cast is safe by construction: the member it can't be is `in`, whose
    // value must be an array, and `FilterOpName` excludes it.
    where[field.name] = {
      op: filter.op,
      value: filterValue(field, filter.text),
    } as FilterOp;
  }

  return Object.keys(where).length > 0 ? where : undefined;
}

/**
 * How a filter reads as a chip: the field's label, then what is being asked of it. The value goes
 * through `formatCell`, the same renderer the table's cells use, so a relation filter reads as the
 * referenced record's name and a boolean as "Sim" — never as the id or the `true` the query
 * carries.
 * @param field - The filtered field.
 * @param filter - The filter to describe.
 * @param [relations] - `id -> label` per referenced collection, for a relation filter.
 * @returns The chip's text.
 */
export function describeFilter(
  field: Field,
  filter: ListFilter,
  relations: RelationLabels = {},
): string {
  const value = formatCell(field, filterValue(field, filter.text), relations);
  const predicate = filter.op === "eq" ? value : `${OP_LABELS[filter.op]} ${value}`;
  return `${fieldLabel(field)}: ${predicate}`;
}
