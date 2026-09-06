import { ApiError, toErrorResponse, type FallingHandler } from "@shuri/api";
import { UnauthenticatedError } from "@shuri/auth";
import type { ResolvedAdminAuth } from "./access.js";

/** A signed-in user the host's `authorize` turned away. 403, not 401: signing in again changes nothing. */
export class AdminForbiddenError extends ApiError {
  constructor() {
    super(403, "Not allowed to use the admin");
    this.name = "AdminForbiddenError";
  }
}

/**
 * Refuses every request `auth.protect` matches unless an authorized session is behind it, and
 * declines the rest so the routes they belong to still get their turn.
 *
 * It guards **the app's REST routes**, not the admin's own pages — which is the only place a guard
 * can do anything, because the admin edits through those routes and holds no data of its own.
 * Refusing to serve `/admin` instead would be theatre: the bundle is generic code, and the records
 * would still be one `curl` away.
 *
 * By the same token the bundle and the schema document stay public. The login form is drawn from
 * that document, so gating it would leave a signed-out visitor with nothing to sign in *with*; the
 * document withholds every collection and global instead (see `schema/build.ts#shellSchema`).
 *
 * Mounted first — `create()`'s `handlers` run ahead of every built-in route, and ahead of auth's
 * own, so a login request still reaches the routes that issue a session.
 * @param auth - The resolved auth: what to protect, and how to resolve a session.
 * @returns A handler answering 401/403 for a protected request without one, `undefined` otherwise.
 */
export function createAdminGuard(auth: ResolvedAdminAuth): FallingHandler {
  return async function handleRequest(request) {
    if (!auth.protect(request)) return undefined;

    try {
      const access = await auth.resolve(request);
      // `setup` is refused exactly like `anonymous`: an app with no account has no administrator
      // either, so the first-run window must not be a window in which writes are unguarded.
      if (access.status === "setup" || access.status === "anonymous") {
        throw new UnauthenticatedError();
      }
      if (access.status === "forbidden") throw new AdminForbiddenError();
      return undefined;
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
