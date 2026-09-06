import type { Query, RecordId, RecordInput, StoreRecord } from "@shuri/store";
import type { Issue } from "@shuri/validate";
import { AdminRequestError } from "./errors.js";
import type { AdminSchema } from "./schema.js";

/** The `fetch` the client issues requests through — SvelteKit's own during a `load`, the global one otherwise. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AdminClientOptions {
  /** The `fetch` to issue requests through. Defaults to the global one. */
  fetch?: FetchLike;
  /**
   * Origin the REST paths are resolved against, e.g. `https://cms.example.com`. Defaults to `""`,
   * i.e. same-origin — which is the case whenever the admin is served by the app's own handler.
   */
  origin?: string;
}

/**
 * Reads a collection's records and a global's record over the app's REST routes.
 *
 * Every method speaks the same shapes `@shuri/api` serves, and turns a non-2xx answer into an
 * `AdminRequestError` carrying the server's `issues` — the admin never inspects a raw `Response`.
 */
export interface AdminClient {
  list(slug: string, query?: Query): Promise<StoreRecord[]>;
  get(slug: string, id: RecordId): Promise<StoreRecord>;
  create(slug: string, data: RecordInput): Promise<StoreRecord>;
  update(slug: string, id: RecordId, data: RecordInput): Promise<StoreRecord>;
  remove(slug: string, id: RecordId): Promise<void>;
  getGlobal(slug: string): Promise<RecordInput>;
  updateGlobal(slug: string, data: RecordInput): Promise<RecordInput>;
}

interface ErrorBody {
  error?: unknown;
  issues?: unknown;
}

/**
 * Turns a failed response into the error the admin handles, reading `error`/`issues` off the body
 * when there is one. A body that isn't the expected JSON (a proxy's HTML error page, say) still
 * produces an error naming the status, so no failure surfaces as a silent `undefined`.
 * @param response - The non-2xx response to convert.
 * @returns The error describing `response`.
 */
async function toRequestError(response: Response): Promise<AdminRequestError> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // Falls through to the status-only message below.
  }
  const message =
    typeof body.error === "string" ? body.error : `Request failed (${response.status})`;
  const issues = Array.isArray(body.issues) ? (body.issues as Issue[]) : [];
  return new AdminRequestError(response.status, message, issues);
}

/**
 * Encodes a `Query` onto search params the way `@shuri/api`'s `parseQuery` reads it back: `limit`
 * and `offset` as plain numbers, `where` and `orderBy` as JSON. Absent parts are left out rather
 * than sent empty, so a query with no filter produces a bare URL.
 * @param query - The query to encode.
 * @returns The encoded search params, empty when `query` is.
 */
export function encodeQuery(query: Query = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.where && Object.keys(query.where).length > 0) {
    params.set("where", JSON.stringify(query.where));
  }
  if (query.orderBy && query.orderBy.length > 0) {
    params.set("orderBy", JSON.stringify(query.orderBy));
  }
  return params;
}

/**
 * The `RequestInit` for a write: the app's REST routes require a JSON content type.
 * @param method - The HTTP method to send.
 * @param data - The record body to send.
 * @returns The request options carrying `data` as JSON.
 */
function jsonBody(method: string, data: RecordInput): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  };
}

/**
 * Fetches the document describing everything the admin renders. Separate from `createAdminClient`
 * because it is what produces that function's argument: the schema names the REST base paths, so
 * the data client can't be built before it has been read.
 * @param basePath - The path the admin is mounted at, e.g. `/admin`.
 * @param [options] - The `fetch` to use and the origin to resolve against.
 * @returns The admin schema served by the app.
 */
export async function fetchAdminSchema(
  basePath: string,
  options: AdminClientOptions = {},
): Promise<AdminSchema> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(`${options.origin ?? ""}${basePath}/schema.json`);
  if (!response.ok) throw await toRequestError(response);
  return (await response.json()) as AdminSchema;
}

/**
 * Binds the REST operations to the base paths `schema` declares, so callers name a slug and never
 * a URL.
 * @param schema - The admin schema, read for `api.collections`/`api.globals`.
 * @param [options] - The `fetch` to use and the origin to resolve against.
 * @returns A client over the app's collections and globals.
 */
export function createAdminClient(
  schema: Pick<AdminSchema, "api">,
  options: AdminClientOptions = {},
): AdminClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const origin = options.origin ?? "";

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(`${origin}${path}`, init);
    if (!response.ok) throw await toRequestError(response);
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  const collections = schema.api.collections;
  const globals = schema.api.globals;

  return {
    list(slug, query) {
      const params = encodeQuery(query);
      const search = params.size > 0 ? `?${params}` : "";
      return request<StoreRecord[]>(`${collections}/${slug}${search}`);
    },
    get: (slug, id) => request<StoreRecord>(`${collections}/${slug}/${id}`),
    create: (slug, data) =>
      request<StoreRecord>(`${collections}/${slug}`, jsonBody("POST", data)),
    update: (slug, id, data) =>
      request<StoreRecord>(`${collections}/${slug}/${id}`, jsonBody("PATCH", data)),
    remove: (slug, id) =>
      request<void>(`${collections}/${slug}/${id}`, { method: "DELETE" }),
    getGlobal: (slug) => request<RecordInput>(`${globals}/${slug}`),
    updateGlobal: (slug, data) =>
      request<RecordInput>(`${globals}/${slug}`, jsonBody("PATCH", data)),
  };
}
