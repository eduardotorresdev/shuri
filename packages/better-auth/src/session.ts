import type { AdminSession, AdminSessionUser } from "@shuri/ui";

/** The slice of a better-auth instance the session shim needs. */
export interface BetterAuthSessionApi {
  api: {
    getSession(input: { headers: Headers }): Promise<BetterAuthSession | null>;
  };
}

/** What better-auth's `getSession` resolves to, narrowed to the fields mapped below. */
export interface BetterAuthSession {
  session: { id: string; expiresAt: Date | string };
  user: { id: string; email: string; name?: string | null; [field: string]: unknown };
}

/**
 * Reshapes a better-auth user into the admin's `AdminSessionUser`.
 *
 * `name` is pulled out of the spread rather than written over it: better-auth stores an absent name
 * as `null`, and `AdminSessionUser.name` is `string | undefined`, so spreading first would carry the
 * `null` straight through and every `user.name ?? user.email` fallback downstream would render it.
 * @param user - The user as better-auth returned it.
 * @returns The user in the admin's shape.
 */
export function toAdminSessionUser(user: BetterAuthSession["user"]): AdminSessionUser {
  const { name, ...rest } = user;
  return {
    ...rest,
    id: user.id,
    email: user.email,
    ...(typeof name === "string" ? { name } : {}),
  };
}

/**
 * Reshapes a better-auth session into the admin's `AdminSession`.
 *
 * That type is the lingua franca `@shuri/ui` speaks — its guard takes an `AdminSessionSource`
 * defined in those terms — so mapping here is what lets better-auth drop in with no change to the
 * admin at all.
 * @param resolved - What better-auth's `getSession` returned.
 * @returns The session in the admin's shape.
 */
export function toAdminSession(resolved: BetterAuthSession): AdminSession {
  const { user, session } = resolved;
  const expiresAt =
    session.expiresAt instanceof Date
      ? session.expiresAt.getTime()
      : Date.parse(session.expiresAt);

  return { id: session.id, expiresAt, user: toAdminSessionUser(user) };
}

/**
 * Resolves the session behind a request, in the shape `@shuri/ui`'s admin guard expects.
 * @param auth - The better-auth instance.
 * @returns A function resolving a request's session, `undefined` when there is none.
 */
export function toSessionResolver(
  auth: BetterAuthSessionApi,
): (request: Request) => Promise<AdminSession | undefined> {
  return async function getSession(request) {
    const resolved = await auth.api.getSession({ headers: request.headers });
    return resolved ? toAdminSession(resolved) : undefined;
  };
}
