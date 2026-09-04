import { ApiError, IssuesApiError } from "@shuri/api";
import { ValidationError, type Issue } from "@shuri/validate";

/**
 * Every error here extends `ApiError` or `IssuesApiError`, which is the whole reason `@shuri/api`'s
 * `toErrorResponse` needs no change: it branches on those two base classes, never on a registry of
 * concrete ones. The import edge stays one-way, `auth -> api`.
 */

/**
 * The one answer to every credential failure: unknown email, account without a password, and wrong
 * password all produce this exact error. Same status, same message, no `issues` — anything that told
 * them apart would be a user-enumeration oracle readable from the open internet.
 */
export class AuthenticationFailedError extends ApiError {
  constructor() {
    super(401, "Invalid email or password");
    this.name = "AuthenticationFailedError";
  }
}

/** No usable session on the request: no cookie, no bearer, or one that no longer resolves. */
export class UnauthenticatedError extends ApiError {
  constructor() {
    super(401, "Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Signup hit an email already registered. This does leak that the address exists — closing it means
 * always answering 201 and sending a warning email, i.e. the email verification flow that is
 * explicitly out of scope for this round.
 */
export class EmailAlreadyRegisteredError extends ApiError {
  constructor() {
    super(409, "Email already registered");
    this.name = "EmailAlreadyRegisteredError";
  }
}

/** The signup/login payload is malformed (missing email, password too short, ...). */
export class InvalidCredentialsError extends IssuesApiError {
  constructor(issues: Issue[]) {
    super(400, issues);
    this.name = "InvalidCredentialsError";
  }
}

/**
 * A mutating route was called without `content-type: application/json`. Part of this round's CSRF
 * posture: a cross-origin `<form>` can't set that header without a preflight the browser will block.
 */
export class UnsupportedMediaTypeError extends ApiError {
  constructor() {
    super(415, "Expected content-type: application/json");
    this.name = "UnsupportedMediaTypeError";
  }
}

/** A consumer collection reuses a slug `@shuri/auth` owns. Thrown at `create()` time, never per request. */
export class AuthSlugCollisionError extends ValidationError {
  constructor(slug: string) {
    super([
      {
        path: `collections.${slug}`,
        message: `"${slug}" is reserved by @shuri/auth. Rename your collection and give it a relation to "users" instead.`,
      },
    ]);
    this.name = "AuthSlugCollisionError";
  }
}

/** The auth config itself is unusable (no secret with OIDC configured, `SameSite=None` without `Secure`, ...). */
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/**
 * Every failure of the OIDC transaction cookie shares this one error and this one message: absent,
 * tampered with, expired, issued for another provider, or with a `state` that doesn't echo. Someone
 * probing the callback learns which of those it was only if we tell them.
 */
export class OAuthTransactionError extends ApiError {
  constructor() {
    super(400, "Invalid or expired sign-in transaction");
    this.name = "OAuthTransactionError";
  }
}

/**
 * No provider is configured under that id — neither a static declaration nor a `OidcProviderSlot`,
 * nor (for a slot) a matching `_oidc_credentials` row. The three cases are indistinguishable on
 * purpose: from a caller's perspective a slot with no credentials yet isn't usable, which is exactly
 * what "unknown" already means.
 */
export class UnknownProviderError extends ApiError {
  constructor(id: string) {
    super(404, `Unknown identity provider "${id}"`);
    this.name = "UnknownProviderError";
  }
}

/**
 * A `OidcProviderSlot` matched a `_oidc_credentials` row, but the row is missing a field its preset
 * needs (e.g. `microsoft` without a `tenant`). Distinct from `UnknownProviderError`: an admin got far
 * enough to create the row, so telling them what's still missing is a kindness, not an oracle — this
 * never reaches an unauthenticated caller with something to learn from it.
 */
export class IncompleteOidcCredentialsError extends ApiError {
  constructor(id: string, message: string) {
    super(500, `Incomplete OIDC credentials for provider "${id}": ${message}`);
    this.name = "IncompleteOidcCredentialsError";
  }
}

/**
 * The identity provider misbehaved or refused: discovery failed a check, the token endpoint errored,
 * or the id_token's claims didn't hold. Never reflects the provider's own `error_description` — that
 * string is attacker-influenced and would land in our response body verbatim.
 */
export class OidcProviderError extends ApiError {
  constructor(message = "The identity provider could not complete the sign-in") {
    super(502, message);
    this.name = "OidcProviderError";
  }
}

/**
 * A sign-in that would have taken over an existing local account on the strength of an *unverified*
 * email. Generic on purpose: saying "an account already exists for this address" turns the callback
 * into an account-existence oracle, which is exactly the pre-emptive-takeover surface being closed.
 */
export class AccountLinkRefusedError extends ApiError {
  constructor() {
    super(403, "This identity cannot be used to sign in");
    this.name = "AccountLinkRefusedError";
  }
}

/** The provider returned no email claim, so no account can be created or matched. */
export class MissingEmailClaimError extends ApiError {
  constructor() {
    super(
      400,
      'The identity provider returned no email address. Request the "email" scope.',
    );
    this.name = "MissingEmailClaimError";
  }
}

/** A provider declaration is malformed. Thrown at config time, never per request. */
export class OidcConfigError extends ValidationError {
  constructor(issues: Issue[]) {
    super(issues);
    this.name = "OidcConfigError";
  }
}
