import type { AccessContext, Principal } from "@shuri/core";
import { ForbiddenError, UnauthenticatedError } from "./errors.js";

/** Resolves who is behind a request. `@shuri/better-auth` provides one; a host may provide its own. */
export type PrincipalResolver = (request: Request) => Promise<Principal>;

/**
 * Turns access control on for a handler. Absent, no guard runs at all and every route stays as open
 * as it was — the compatibility mode an app without auth is in.
 */
export interface AccessOptions {
  principal: PrincipalResolver;
}

/** The principal of a request nothing identified. */
export const ANONYMOUS: Principal = { kind: "anonymous" };

/**
 * Refuses the request in the status its principal deserves: 401 when nobody is identified (the
 * caller may sign in and retry), 403 when somebody is and the policy still said no.
 * @param principal - The principal the decision was made for.
 * @returns Never; always throws.
 */
export function deny(principal: Principal): never {
  if (principal.kind === "anonymous") throw new UnauthenticatedError();
  throw new ForbiddenError();
}

/**
 * Resolves the principal once and builds the base context every rule on this request will see —
 * with `user`/`client` filled in per the principal's kind, so a rule reads `ctx.user?.id` instead
 * of narrowing a union.
 * @param access - The access options, holding the resolver.
 * @param request - The incoming request.
 * @returns The base access context of the request.
 */
export async function resolveAccessContext(
  access: AccessOptions,
  request: Request,
): Promise<AccessContext> {
  const principal = await access.principal(request);
  return {
    principal,
    request,
    ...(principal.kind === "user" ? { user: principal.user } : {}),
    ...(principal.kind === "client" ? { client: principal.client } : {}),
  };
}
