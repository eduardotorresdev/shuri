import { STORE_EVENT_TYPES, type StoreEventType } from "@shuri/store";
import {
  arrayOf,
  object,
  oneOf,
  optional,
  required,
  validate,
  type Validator,
} from "@shuri/validate";
import { InvalidEventQueryError } from "./errors.js";

/** Which events a client asked for. An absent selector matches everything; see `filter.ts`. */
export interface EventSelection {
  collection?: string[];
  global?: string[];
  id?: string[];
  events?: StoreEventType[];
}

interface RawEventSelection {
  collection?: unknown;
  global?: unknown;
  id?: unknown;
  events?: unknown;
}

const nameListValidator = (param: string): Validator<unknown> =>
  arrayOf(
    required(`"${param}" entries must not be empty`),
    `"${param}" must be a list of names`,
  );

const eventSelectionValidator = object<RawEventSelection>({
  collection: optional(nameListValidator("collection")),
  global: optional(nameListValidator("global")),
  id: optional(nameListValidator("id")),
  events: optional(
    arrayOf(
      oneOf(STORE_EVENT_TYPES, `"events" must be one of ${STORE_EVENT_TYPES.join(", ")}`),
      '"events" must be a list of event names',
    ),
  ),
});

/**
 * Reads a param that accepts both repetition (`collection=a&collection=b`) and commas
 * (`collection=a,b`) — uniformly across every selector, since neither a slug nor a record id can
 * contain a comma. Empty entries are kept so validation reports them at their own index instead of
 * silently dropping them.
 * @param searchParams - The request URL's search params.
 * @param param - The param to read.
 * @returns The listed values, or `undefined` when the param is absent.
 */
function readList(searchParams: URLSearchParams, param: string): string[] | undefined {
  const raw = searchParams.getAll(param);
  if (raw.length === 0) return undefined;
  return raw.flatMap((value) => value.split(","));
}

/**
 * Reads the event selection off URL search params, validated through `@shuri/validate` combinators
 * the same way `collections/query.ts` reads the `Query` AST. Throws `InvalidEventQueryError` for
 * anything malformed, so a stream is never opened against a selection that can't match.
 * @param searchParams - The request URL's search params.
 * @returns The parsed and validated event selection.
 */
export function parseEventQuery(searchParams: URLSearchParams): EventSelection {
  const raw: RawEventSelection = {
    collection: readList(searchParams, "collection"),
    global: readList(searchParams, "global"),
    id: readList(searchParams, "id"),
    events: readList(searchParams, "events"),
  };

  const issues = validate(raw, eventSelectionValidator, "query");
  if (issues.length > 0) throw new InvalidEventQueryError(issues);

  return raw as EventSelection;
}
