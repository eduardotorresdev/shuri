import { ApiError } from "../errors.js";

/**
 * No usable principal on the request — no cookie, no bearer, or one that no longer resolves — and
 * the operation isn't open to anonymous callers. Declared here rather than in `@shuri/auth` because
 * the guards in this folder throw it; auth re-exports it under the same name.
 */
export class UnauthenticatedError extends ApiError {
  constructor() {
    super(401, "Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

/** The request carries a principal, and the policy still says no: a rule refused it, or a client lacks the scope. */
export class ForbiddenError extends ApiError {
  constructor() {
    super(403, "Forbidden");
    this.name = "ForbiddenError";
  }
}
