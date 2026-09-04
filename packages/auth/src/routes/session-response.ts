import { jsonResponse } from "@shuri/api";
import type { AuthContext } from "../config.js";
import type { IssuedSession } from "../types.js";

/**
 * The response every credential flow ends in: the public user plus the `Set-Cookie` carrying the one
 * copy of the session token that will ever exist.
 * @param context - The resolved auth context.
 * @param issued - The session just created.
 * @param [status] - The HTTP status; 201 for signup, 200 for login.
 * @returns The JSON response, cookie included.
 */
export function issuedSessionResponse(
  context: AuthContext,
  issued: IssuedSession,
  status = 200,
): Response {
  return jsonResponse(
    { user: issued.user },
    {
      status,
      headers: {
        "set-cookie": context.cookies.issue(issued.token, issued.session.expiresAt),
      },
    },
  );
}
