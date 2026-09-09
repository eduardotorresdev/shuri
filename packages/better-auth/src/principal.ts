import { ANONYMOUS, type PrincipalResolver } from "@shuri/api";
import { toAdminSessionUser, type BetterAuthSessionApi } from "./session.js";

/**
 * Resolves a request's principal for `@shuri/api`'s access control: the better-auth session's user,
 * or `ANONYMOUS` when there is none.
 *
 * Never throws — an expired or forged cookie resolves to anonymous, exactly like no cookie. Whether
 * anonymous is enough is the policy's call, not this one's.
 *
 * A user carries no scopes: like Payload CMS, any signed-in user may do anything a collection's
 * `access` rule doesn't forbid, and the rule sees `ctx.user` (this user, `role` included when
 * better-auth's `admin` plugin declares one) to decide.
 * @param auth - The better-auth instance.
 * @returns The principal resolver to hand `createHandler`'s `access`.
 */
export function toPrincipalResolver(auth: BetterAuthSessionApi): PrincipalResolver {
  return async function resolvePrincipal(request) {
    const resolved = await auth.api.getSession({ headers: request.headers });
    return resolved
      ? { kind: "user", user: toAdminSessionUser(resolved.user) }
      : ANONYMOUS;
  };
}
