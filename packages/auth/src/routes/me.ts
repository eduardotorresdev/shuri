import { jsonResponse, MethodNotAllowedError } from "@shuri/api";
import type { AuthContext } from "../config.js";
import { UnauthenticatedError } from "../errors.js";

/**
 * `GET {basePath}/me` — the current user, or 401.
 *
 * Re-emits the session cookie when reading the session slid its expiry forward, which is what makes
 * sliding renewal visible to the browser instead of only to the store.
 * @param context - The resolved auth context.
 * @param request - The incoming request.
 * @returns The 200 response, or throws `UnauthenticatedError`.
 */
export async function handleMe(
  context: AuthContext,
  request: Request,
): Promise<Response> {
  if (request.method !== "GET") throw new MethodNotAllowedError(request.method);

  const token = context.cookies.read(request);
  const session = token ? await context.sessions.resolve(token) : undefined;
  if (!session || !token) throw new UnauthenticatedError();

  return jsonResponse(
    { user: session.user },
    session.renewed
      ? { headers: { "set-cookie": context.cookies.issue(token, session.expiresAt) } }
      : {},
  );
}
