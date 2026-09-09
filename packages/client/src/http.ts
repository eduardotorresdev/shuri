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

/** The one HTTP seam every client surface goes through: URL joining, the bearer header, the cookie jar, error mapping. */
export interface Http {
  /** Absolute URL for `path` under the base URL, `query` appended when it has entries. */
  url(path: string, query?: URLSearchParams): string;
  /** A raw request with the ambient headers (bearer, cookies, credentials) applied; never throws for a status. */
  send(method: string, path: string, options?: RequestOptions): Promise<Response>;
  /** `send`, then: throws `ClientError` for a non-2xx, resolves `undefined` for a 204, the parsed JSON otherwise. */
  json<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
  getToken(): string | undefined;
  setToken(token: string | undefined): void;
  /** Forgets every cookie the jar holds. */
  clearCookies(): void;
}

/**
 * The cookies a runtime with no jar of its own would otherwise drop.
 *
 * A browser filters `Set-Cookie` out of every response (`getSetCookie()` answers `[]`) and sends
 * the cookie by itself, so this stays empty there and `credentials: "include"` does the work. In
 * Node, Deno or Bun the header is visible and nothing carries it, so the session better-auth sets
 * on sign-in would be lost on the very next request without this.
 */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  /**
   * Records every cookie a response set; one with `Max-Age=0` (how better-auth clears a session on
   * sign-out) is forgotten.
   * @param response - The response whose `Set-Cookie` headers to read.
   */
  absorb(response: Response): void {
    const headers =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    for (const header of headers) {
      const [pair = "", ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) =>
        /^\s*max-age=0*\s*$/i.test(attribute),
      );
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /**
   * Joins the jar into one header.
   * @returns The `Cookie` header value, or `undefined` when there is nothing to send.
   */
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  clear(): void {
    this.cookies.clear();
  }
}

/** The methods a CSRF check has no interest in: they change nothing. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The origin a base URL names, or `undefined` for a relative one (`/api`, as a browser page would
 * pass — and there the browser sends the real `Origin` itself).
 * @param baseUrl - The client's base URL.
 * @returns `scheme://host[:port]`, or `undefined` when `baseUrl` is not absolute.
 */
export function originOf(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return undefined;
  }
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
  const jar = new CookieJar();
  const origin = originOf(baseUrl);
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
    const cookie = jar.header();
    if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
    // better-auth refuses a state-changing request that carries a cookie but no `Origin` (its CSRF
    // check). A browser sets the header itself and ignores this one — `origin` is a forbidden
    // header name for `fetch` — so this only ever speaks for a script, naming the server it talks to.
    if (origin && !SAFE_METHODS.has(method.toUpperCase()) && !headers.has("origin")) {
      headers.set("origin", origin);
    }
    const hasBody = request.body !== undefined;
    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetchImpl(url(path, request.query), {
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
    jar.absorb(response);
    return response;
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
    clearCookies: () => jar.clear(),
  };
}
