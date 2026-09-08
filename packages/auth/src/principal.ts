import { ANONYMOUS } from "@shuri/api";
import type { Principal } from "@shuri/core";
import { CLIENT_TOKEN_PREFIX } from "./clients/tokens.js";
import type { AuthContext } from "./config.js";
import { readBearerToken } from "./http/bearer.js";

/**
 * Who is behind a request, in the vocabulary `@shuri/api`'s access guards speak. A bearer token
 * starting with `sct_` is a client token and is looked up in `_client_tokens`; anything else is a
 * session credential (bearer first, then the cookie) and is looked up in `_sessions`. The prefix
 * decides the table in O(1), so a request costs one store read either way. Nothing usable resolves
 * to `ANONYMOUS`, never to an error: whether anonymous is enough is the policy's call, not this one's.
 * @param context - The resolved auth context.
 * @param request - The incoming request.
 * @returns The principal.
 */
export async function resolvePrincipal(
  context: AuthContext,
  request: Request,
): Promise<Principal> {
  const bearer = readBearerToken(request);
  if (bearer?.startsWith(CLIENT_TOKEN_PREFIX)) {
    return (await context.clientTokens.resolve(bearer)) ?? ANONYMOUS;
  }

  const token = context.cookies.read(request);
  const session = token ? await context.sessions.resolve(token) : undefined;
  return session ? { kind: "user", user: session.user } : ANONYMOUS;
}
