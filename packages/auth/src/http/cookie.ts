import { AuthConfigError } from "../errors.js";

export type SameSite = "Lax" | "Strict" | "None";

export interface CookieOptions {
  /** Cookie name. Defaults to "shuri_session" for the session cookie. */
  name?: string;
  /**
   * Whether to set `Secure`. Defaults to `true`; a dev server on plain `http://localhost` has to
   * turn it off, or the browser never stores the cookie at all.
   */
  secure?: boolean;
  /**
   * Defaults to `Lax`. `Strict` is not a safer default here, it is a broken one: the browser
   * withholds a `Strict` cookie on *any* top-level navigation coming from another site, and the
   * OIDC callback is exactly that — every OIDC login would fail, and every link from an email
   * would land logged out.
   */
  sameSite?: SameSite;
  path?: string;
  domain?: string;
}

export interface ResolvedCookieOptions {
  name: string;
  secure: boolean;
  sameSite: SameSite;
  path: string;
  domain?: string;
}

export const SESSION_COOKIE_NAME = "shuri_session";

/**
 * Fills in the defaults and rejects a combination the browser would silently drop.
 *
 * `HttpOnly` is not among the options on purpose: a session cookie readable from JavaScript turns
 * every XSS into a full account takeover, and there is no legitimate reason for a host to opt out.
 * @param [options] - The cookie options declared by the host.
 * @param [name] - The cookie name to default to.
 * @returns The resolved options, every field filled in.
 */
export function resolveCookieOptions(
  options: CookieOptions = {},
  name: string = SESSION_COOKIE_NAME,
): ResolvedCookieOptions {
  const resolved: ResolvedCookieOptions = {
    name: options.name ?? name,
    secure: options.secure ?? true,
    sameSite: options.sameSite ?? "Lax",
    path: options.path ?? "/",
    domain: options.domain,
  };

  if (resolved.sameSite === "None" && !resolved.secure) {
    throw new AuthConfigError(
      'A cookie with SameSite=None must also be Secure, or the browser will reject it. Set cookie.secure to true or use SameSite="Lax".',
    );
  }
  return resolved;
}

/**
 * Serializes one `Set-Cookie` value.
 *
 * Lifetime travels as `Max-Age`, never as `Expires`: `Max-Age` is relative, so a client whose clock
 * is off by hours still expires the cookie when we meant it to, and there is no HTTP-date to format.
 * @param options - The resolved cookie options.
 * @param value - The cookie value; percent-encoded on the way out.
 * @param maxAgeSeconds - Lifetime in seconds. `0` expires the cookie immediately.
 * @returns The `Set-Cookie` header value.
 */
export function serializeCookie(
  options: ResolvedCookieOptions,
  value: string,
  maxAgeSeconds: number,
): string {
  const parts = [
    `${options.name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    `SameSite=${options.sameSite}`,
    "HttpOnly",
  ];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Serializes the `Set-Cookie` that deletes the cookie.
 *
 * Must be built from the *same resolved options* as the cookie it clears: a browser matches cookies
 * for replacement by name, domain and path, so a clear with a different `Path` leaves the original
 * one alive and the user still signed in.
 * @param options - The very options the cookie being cleared was written with.
 * @returns The `Set-Cookie` header value that deletes the cookie.
 */
export function clearCookie(options: ResolvedCookieOptions): string {
  return serializeCookie(options, "", 0);
}

/**
 * Parses a `Cookie` header into name/value pairs.
 *
 * Tolerant by necessity — the header is a shared bus carrying third-party cookies this package
 * never wrote. It splits on the **first** `=` only (base64 values contain `=`), skips empty pairs
 * from `;;`, strips surrounding quotes, keeps the first occurrence of a repeated name, and falls
 * back to the raw value when `decodeURIComponent` throws `URIError` on a malformed escape. One
 * broken cookie from an unrelated script must never turn every request into a 500.
 * @param header - The raw `Cookie` header value, or `null` when absent.
 * @returns The parsed cookies, keyed by name.
 */
export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;

    const name = pair.slice(0, separator).trim();
    if (!name || cookies.has(name)) continue;

    const raw = pair.slice(separator + 1).trim();
    const unquoted =
      raw.length > 1 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    cookies.set(name, decodeValue(unquoted));
  }
  return cookies;
}

function decodeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Reads one cookie off a request.
 * @param request - The incoming request.
 * @param name - The cookie name to read.
 * @returns The cookie value, or `undefined` when it isn't present.
 */
export function readCookie(request: Request, name: string): string | undefined {
  return parseCookies(request.headers.get("cookie")).get(name);
}
