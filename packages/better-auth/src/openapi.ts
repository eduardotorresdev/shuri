import type { OpenApiSecurity } from "@shuri/api";
import type { BetterAuthOptions } from "better-auth";
import { DEFAULT_API_KEY_HEADERS } from "./api-key.js";

/** better-auth's default cookie prefix, and what `advanced.cookiePrefix` falls back to. */
const DEFAULT_COOKIE_PREFIX = "better-auth";

/** The options this file reads, narrowed so a test can pass a literal. */
export type CookieNameOptions = Pick<BetterAuthOptions, "advanced" | "baseURL">;

/** The options the security block reads: the cookie's, plus `plugins` to see whether API keys are on. */
export type SecurityOptions = CookieNameOptions & Pick<BetterAuthOptions, "plugins">;

/**
 * Whether `@better-auth/api-key` is among better-auth's plugins.
 * @param options - better-auth's own options.
 * @returns `true` when keys are on.
 */
export function hasApiKeys(options: Pick<BetterAuthOptions, "plugins">): boolean {
  return options.plugins?.some((plugin) => plugin.id === "api-key") ?? false;
}

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
 * How `/openapi.json` describes authentication once better-auth guards the routes: the session
 * cookie and — with `@better-auth/api-key` on — the key header, either one satisfying every
 * guarded operation. Neither scheme lists scopes: OpenAPI reserves those for OAuth2, and a key's
 * scopes are its own permissions, not something a caller negotiates per request.
 * @param options - better-auth's own options, for the cookie name and the plugin list.
 * @param [apiKeyHeaders] - The headers a key may arrive in; the first is the one documented.
 * @returns The security block for `createOpenApiHandler`.
 */
export function betterAuthOpenApiSecurity(
  options: SecurityOptions,
  apiKeyHeaders: readonly string[] = DEFAULT_API_KEY_HEADERS,
): OpenApiSecurity {
  const keys = hasApiKeys(options);
  const requirements: OpenApiSecurity["requirements"] = () => {
    const alternatives: ReturnType<OpenApiSecurity["requirements"]> = [
      { cookieAuth: [] },
    ];
    if (keys) alternatives.push({ apiKeyAuth: [] });
    return alternatives;
  };
  return {
    schemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: sessionCookieName(options) },
      ...(keys
        ? { apiKeyAuth: { type: "apiKey", in: "header", name: apiKeyHeaders[0] } }
        : {}),
    },
    requirements,
  };
}
