import type { OpenApiSecurity } from "@shuri/api";
import type { BetterAuthOptions } from "better-auth";

/** better-auth's default cookie prefix, and what `advanced.cookiePrefix` falls back to. */
const DEFAULT_COOKIE_PREFIX = "better-auth";

/** The options this file reads, narrowed so a test can pass a literal. */
export type CookieNameOptions = Pick<BetterAuthOptions, "advanced" | "baseURL">;

/**
 * Whether better-auth will mark its cookies `Secure`, following its own rule: `advanced
 * .useSecureCookies` when set, else an `https://` base URL, else a production `NODE_ENV`.
 * @param options - better-auth's own options.
 * @returns Whether the cookie is `Secure`.
 */
function usesSecureCookies(options: CookieNameOptions): boolean {
  if (options.advanced?.useSecureCookies !== undefined) {
    return options.advanced.useSecureCookies;
  }
  if (typeof options.baseURL === "string") return options.baseURL.startsWith("https://");
  return process.env["NODE_ENV"] === "production";
}

/**
 * The name of better-auth's session cookie, as `advanced` configures it: `{prefix}.session_token`
 * (or the name `advanced.cookies.session_token` overrides it with), behind the `__Secure-` prefix
 * when the cookie is `Secure`.
 *
 * Computed from the options rather than read off the built instance, because the OpenAPI document
 * is assembled synchronously inside `create()` while better-auth's context is a promise.
 * @param options - better-auth's own options.
 * @returns The cookie name.
 */
export function sessionCookieName(options: CookieNameOptions): string {
  const prefix = options.advanced?.cookiePrefix ?? DEFAULT_COOKIE_PREFIX;
  const name =
    options.advanced?.cookies?.session_token?.name ?? `${prefix}.session_token`;
  return usesSecureCookies(options) ? `__Secure-${name}` : name;
}

/**
 * How `/openapi.json` describes authentication once better-auth guards the routes: one `apiKey`
 * scheme in the cookie, and every guarded operation requiring it. A user carries no scopes, so the
 * requirement lists none.
 * @param options - better-auth's own options, for the cookie name.
 * @returns The security block for `createOpenApiHandler`.
 */
export function betterAuthOpenApiSecurity(options: CookieNameOptions): OpenApiSecurity {
  return {
    schemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: sessionCookieName(options) },
    },
    requirements: () => [{ cookieAuth: [] }],
  };
}
