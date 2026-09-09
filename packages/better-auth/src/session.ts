import type { AuthSession, AuthUser } from "@shuri/auth";

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
 * Reshapes a better-auth session into `@shuri/auth`'s `AuthSession`.
 *
 * That type is the lingua franca the rest of the repo already speaks — `@shuri/ui`'s admin guard
 * takes an `AdminSessionSource` defined in its terms — so mapping here is what lets better-auth drop
 * in with **no change to the admin at all**. `renewed` is always `false`: better-auth manages its own
 * cookie refresh inside `auth.handler`, so there is nothing for a caller to re-emit.
 * @param resolved - What better-auth's `getSession` returned.
 * @returns The session in `@shuri/auth`'s shape.
 */
export function toAuthSession(resolved: BetterAuthSession): AuthSession {
  const { user, session } = resolved;
  const expiresAt =
    session.expiresAt instanceof Date
      ? session.expiresAt.getTime()
      : Date.parse(session.expiresAt);

  // `name` is pulled out of the spread rather than written over it: better-auth stores an absent
  // name as `null`, and `AuthUser.name` is `string | undefined`, so spreading first would carry the
  // `null` straight through and every `user.name ?? user.email` fallback downstream would render it.
  const { name, ...rest } = user;

  return {
    id: session.id,
    expiresAt,
    renewed: false,
    user: {
      ...rest,
      id: user.id,
      email: user.email,
      ...(typeof name === "string" ? { name } : {}),
      // `@shuri/auth`'s `AuthUser` declares `createdAt` as epoch milliseconds and better-auth's is a
      // serialized date; parsed when it is one, and 0 rather than NaN when it is absent.
      createdAt: parseCreatedAt(user["createdAt"]),
    } as AuthUser,
  };
}

/**
 * Reads better-auth's `createdAt` as epoch milliseconds.
 * @param value - Whatever better-auth stored, a `Date`, an ISO string, or nothing.
 * @returns The timestamp, or `0` when there is nothing parseable.
 */
function parseCreatedAt(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Resolves the session behind a request, in the shape `@shuri/ui`'s admin guard expects.
 * @param auth - The better-auth instance.
 * @returns A function resolving a request's session, `undefined` when there is none.
 */
export function toSessionResolver(
  auth: BetterAuthSessionApi,
): (request: Request) => Promise<AuthSession | undefined> {
  return async function getSession(request) {
    const resolved = await auth.api.getSession({ headers: request.headers });
    return resolved ? toAuthSession(resolved) : undefined;
  };
}
