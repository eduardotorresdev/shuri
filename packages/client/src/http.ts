import { toClientError } from "./errors.js";

/** The `fetch` the client talks through; injectable so a test can bind it straight to `app.handler`. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  baseUrl: string;
  fetch?: FetchLike;
  token?: string;
  credentials?: RequestCredentials;
}

export interface RequestOptions {
  query?: URLSearchParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** The one HTTP seam every client surface goes through: URL joining, the bearer header, error mapping. */
export interface Http {
  /** Absolute URL for `path` under the base URL, `query` appended when it has entries. */
  url(path: string, query?: URLSearchParams): string;
  /** A raw request with the ambient headers (bearer, credentials) applied; never throws for a status. */
  send(method: string, path: string, options?: RequestOptions): Promise<Response>;
  /** `send`, then: throws `ClientError` for a non-2xx, resolves `undefined` for a 204, the parsed JSON otherwise. */
  json<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
  getToken(): string | undefined;
  setToken(token: string | undefined): void;
}

/**
 * Builds the HTTP seam. The base URL keeps whatever prefix it was given (`https://host/api`), so
 * joining is plain concatenation rather than `new URL(path, base)`, which would drop the prefix.
 * @param options - The base URL, the `fetch` to use, and the initial token/credentials mode.
 * @returns The `Http` seam.
 */
export function createHttp(options: HttpOptions): Http {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const credentials = options.credentials ?? "include";
  let token = options.token;

  function url(path: string, query?: URLSearchParams): string {
    const search = query && [...query.keys()].length > 0 ? `?${query.toString()}` : "";
    return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}${search}`;
  }

  async function send(
    method: string,
    path: string,
    request: RequestOptions = {},
  ): Promise<Response> {
    const headers = new Headers(request.headers);
    if (token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    const hasBody = request.body !== undefined;
    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return fetchImpl(url(path, request.query), {
      method,
      headers,
      credentials,
      signal: request.signal,
      body: hasBody
        ? headers.get("content-type") === "application/json"
          ? JSON.stringify(request.body)
          : (request.body as BodyInit)
        : undefined,
    });
  }

  return {
    url,
    send,
    async json<T>(method: string, path: string, request?: RequestOptions): Promise<T> {
      const response = await send(method, path, request);
      if (!response.ok) throw await toClientError(response);
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
    getToken: () => token,
    setToken(next) {
      token = next;
    },
  };
}
