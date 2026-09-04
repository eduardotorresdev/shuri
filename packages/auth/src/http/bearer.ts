/**
 * Reads a token from `Authorization: Bearer <token>`.
 *
 * A bearer token takes precedence over the cookie wherever both are read: an explicit credential
 * beats an ambient one, and a request authenticated only by a bearer header is inherently immune to
 * CSRF — a browser never attaches it on its own.
 * @param request - The incoming request.
 * @returns The token, or `undefined` when the header is absent or not a bearer one.
 */
export function readBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return undefined;

  const token = rest.join(" ").trim();
  return token || undefined;
}
