import type { Now } from "../types.js";
import {
  clearCookie,
  readCookie,
  serializeCookie,
  type ResolvedCookieOptions,
} from "../http/cookie.js";
import { readBearerToken } from "../http/bearer.js";

/** Writes and reads the session credential, whichever way it travels. */
export interface SessionCookies {
  /** The `Set-Cookie` for a session valid until `expiresAt` (epoch ms). */
  issue(token: string, expiresAt: number): string;
  /** The `Set-Cookie` that deletes it, built from the same resolved options. */
  clear(): string;
  /** The token on a request: `Authorization: Bearer` first, then the cookie. */
  read(request: Request): string | undefined;
}

/**
 * Ties the session credential to one resolved cookie configuration.
 *
 * `read` prefers the bearer header over the cookie: an explicit credential should beat an ambient
 * one, and it means a non-browser client is never at the mercy of whatever cookie the browser
 * happened to attach.
 * @param options - The resolved cookie options, shared by `issue` and `clear`.
 * @param now - The clock, used to turn an absolute expiry into a relative `Max-Age`.
 * @returns The session cookie reader/writer.
 */
export function createSessionCookies(
  options: ResolvedCookieOptions,
  now: Now,
): SessionCookies {
  return {
    issue: (token, expiresAt) =>
      serializeCookie(options, token, (expiresAt - now()) / 1000),
    clear: () => clearCookie(options),
    read: (request) => readBearerToken(request) ?? readCookie(request, options.name),
  };
}
