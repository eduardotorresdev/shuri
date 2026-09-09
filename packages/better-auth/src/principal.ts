import { ANONYMOUS, type PrincipalResolver } from "@shuri/api";
import type { ApiKeyResolver } from "./api-key.js";
import { toAdminSessionUser, type BetterAuthSessionApi } from "./session.js";

export interface PrincipalResolverOptions {
  /**
   * Resolves a machine credential ahead of the session: an API key names a `client`, and a request
   * carrying one is acting as that client whatever cookie rides along.
   */
  apiKeys?: ApiKeyResolver | undefined;
}

/**
 * Resolves a request's principal for `@shuri/api`'s access control: the client behind an API key
 * when the request carries a valid one, else the better-auth session's user, else `ANONYMOUS`.
 *
 * Never throws — an expired or forged cookie, like a revoked key, resolves to anonymous, exactly
 * like no credential at all. Whether anonymous is enough is the policy's call, not this one's.
 *
 * A user carries no scopes: like Payload CMS, any signed-in user may do anything a collection's
 * `access` rule doesn't forbid, and the rule sees `ctx.user` (this user, `role` included when
 * better-auth's `admin` plugin declares one) to decide. A client carries exactly the scopes its
 * key was granted, and the policy checks them before any rule runs.
 * @param auth - The better-auth instance.
 * @param [options] - The API key resolver, when `@better-auth/api-key` is on.
 * @returns The principal resolver to hand `createHandler`'s `access`.
 */
export function toPrincipalResolver(
  auth: BetterAuthSessionApi,
  options: PrincipalResolverOptions = {},
): PrincipalResolver {
  return async function resolvePrincipal(request) {
    const client = await options.apiKeys?.(request);
    if (client) return client;
    const resolved = await auth.api.getSession({ headers: request.headers });
    return resolved
      ? { kind: "user", user: toAdminSessionUser(resolved.user) }
      : ANONYMOUS;
  };
}
