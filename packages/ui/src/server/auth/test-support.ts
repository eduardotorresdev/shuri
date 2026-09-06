import type { AuthSession, AuthUser } from "@shuri/auth";
import type { AdminSessionSource } from "./types.js";

/**
 * A session source over a fixed `token -> user` table, so a test states who a request is without a
 * store, a cookie parser or a password hash.
 * @param sessions - The users to resolve, keyed by the bearer token naming them.
 * @returns A source resolving `Authorization: Bearer <token>` against `sessions`.
 */
export function stubSessions(
  sessions: Readonly<Record<string, Partial<AuthUser>>>,
): AdminSessionSource {
  return {
    async getSession(request) {
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
      const user = token ? sessions[token] : undefined;
      if (!user) return undefined;

      return {
        id: `session-${token}`,
        user: { id: "u1", email: "ada@example.com", createdAt: 0, ...user },
        expiresAt: Number.MAX_SAFE_INTEGER,
        renewed: false,
      } satisfies AuthSession;
    },
  };
}

/**
 * A copy of `request` carrying the token `stubSessions` resolves, or `request` itself for no token —
 * so a test writes the signed-in and signed-out cases the same way.
 * @param token - The token naming the user, or `undefined` for an anonymous request.
 * @param request - The request to authenticate.
 * @returns The request to send.
 */
export function asUser(token: string | undefined, request: Request): Request {
  if (!token) return request;
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}
