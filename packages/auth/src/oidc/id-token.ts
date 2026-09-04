import { decodeBase64UrlText } from "../crypto/base64url.js";
import { timingSafeEqual } from "../crypto/equal.js";
import { OAuthTransactionError, OidcProviderError } from "../errors.js";
import type { IdTokenClaims } from "./types.js";

/** Tolerance for clock drift between us and the provider, both directions. */
export const CLOCK_SKEW_MS = 60_000;
/** How old an `iat` may be. A token minted long before the callback isn't from this sign-in. */
export const MAX_TOKEN_AGE_MS = 600_000;

export interface ClaimExpectations {
  issuer?: string;
  clientId: string;
  /** The nonce from this transaction; the id_token must echo it. */
  nonce: string;
  now: number;
}

/**
 * Decodes an id_token's claims **without verifying its signature**, which is deliberate and
 * sanctioned: OIDC Core 3.1.3.7 item 6 lets a client that received the token straight from the token
 * endpoint, over TLS with the server authenticated by certificate validation, use that TLS
 * validation *in place of* checking the signature. Every precondition holds here (see `token.ts`),
 * so there is no JWKS fetcher, key cache, `kid` selector or RS256 verifier in this package.
 *
 * That holds **only** under direct exchange. The day an implicit/hybrid flow appears, or an endpoint
 * that accepts an id_token posted by a front-end "Sign in with Google" button, JWKS becomes
 * mandatory — which is why decoding and claim validation are separate functions: adding
 * `oidc/jwks.ts` would be one new file and one new call site.
 * @param idToken - The compact JWS from the token endpoint.
 * @returns The decoded claims.
 */
export function decodeIdToken(idToken: string): IdTokenClaims {
  const segments = idToken.split(".");
  if (segments.length !== 3) throw new OidcProviderError("Malformed id_token");

  let claims: unknown;
  try {
    claims = JSON.parse(decodeBase64UrlText(segments[1]));
  } catch {
    throw new OidcProviderError("Malformed id_token");
  }

  if (typeof claims !== "object" || claims === null) {
    throw new OidcProviderError("Malformed id_token");
  }
  return claims as IdTokenClaims;
}

/**
 * Validates the claims, which — with the signature check traded away above — is the entire defense.
 *
 * `iss` must match exactly, `aud` must be (or contain) our `clientId` with `azp` matching when
 * present, `exp` must be in the future and `iat` neither in the future nor stale, `sub` must be a
 * non-empty string, and `nonce` must equal this transaction's, compared in constant time.
 *
 * A `nonce` mismatch raises the *same* generic `OAuthTransactionError` every other transaction
 * failure does; the rest raise a provider error, since they mean the provider sent us something
 * unusable.
 * @param claims - The decoded claims.
 * @param expectations - The issuer, client id, nonce and current time to check against.
 * @returns Nothing; throws when any claim doesn't hold.
 */
export function assertValidClaims(
  claims: IdTokenClaims,
  expectations: ClaimExpectations,
): void {
  const { clientId, now } = expectations;

  if (expectations.issuer !== undefined && claims.iss !== expectations.issuer) {
    throw new OidcProviderError("The id_token was issued by another issuer");
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(clientId)) {
    throw new OidcProviderError("The id_token was issued for another client");
  }
  if (claims.azp !== undefined && claims.azp !== clientId) {
    throw new OidcProviderError("The id_token was authorized for another party");
  }

  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now - CLOCK_SKEW_MS) {
    throw new OidcProviderError("The id_token has expired");
  }
  if (typeof claims.iat !== "number" || claims.iat * 1000 > now + CLOCK_SKEW_MS) {
    throw new OidcProviderError("The id_token was issued in the future");
  }
  if (now - claims.iat * 1000 > MAX_TOKEN_AGE_MS) {
    throw new OidcProviderError("The id_token is too old for this sign-in");
  }

  if (typeof claims.sub !== "string" || claims.sub === "") {
    throw new OidcProviderError("The id_token carries no subject");
  }

  if (
    typeof claims.nonce !== "string" ||
    !timingSafeEqual(claims.nonce, expectations.nonce)
  ) {
    throw new OAuthTransactionError();
  }
}
