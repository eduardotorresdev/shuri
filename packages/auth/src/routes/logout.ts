import { MethodNotAllowedError } from "@shuri/api";
import type { AuthContext } from "../config.js";

/**
 * `POST {basePath}/logout` — revokes the session behind the request, if any, and clears the cookie.
 *
 * `POST` and not `GET`: a `GET` logout is triggered by any `<img src>` on any page, and gets fired
 * for free by link scanners and browser prefetchers. It answers 204 whether or not a session was
 * found — "you are signed out" is true either way, and distinguishing them would leak token
 * validity.
 * @param context - The resolved auth context.
 * @param request - The incoming request.
 * @returns The 204 response carrying the clearing cookie.
 */
export async function handleLogout(
  context: AuthContext,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") throw new MethodNotAllowedError(request.method);

  const token = context.cookies.read(request);
  if (token) await context.sessions.revoke(token);

  return new Response(null, {
    status: 204,
    headers: { "set-cookie": context.cookies.clear() },
  });
}
