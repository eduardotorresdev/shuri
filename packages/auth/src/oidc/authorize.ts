import type { OidcEndpoints, ResolvedProvider } from "./types.js";

export interface AuthorizationRequest {
  state: string;
  nonce: string;
  /** The PKCE `code_challenge`, always `S256`. */
  challenge: string;
}

/**
 * Builds the URL the browser is redirected to, as an Authorization Code request with PKCE.
 *
 * The provider's own `authorizationParams` are applied first, so the parameters that carry this
 * flow's security (`state`, `nonce`, `code_challenge`, `redirect_uri`) can't be overridden by a
 * host's convenience option.
 * @param endpoints - The provider's resolved endpoints.
 * @param provider - The resolved provider.
 * @param request - The state, nonce and PKCE challenge for this transaction.
 * @returns The absolute authorization URL.
 */
export function buildAuthorizationUrl(
  endpoints: OidcEndpoints,
  provider: ResolvedProvider,
  request: AuthorizationRequest,
): string {
  const url = new URL(endpoints.authorization);
  for (const [key, value] of Object.entries(provider.authorizationParams)) {
    url.searchParams.set(key, value);
  }

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", provider.redirectUri);
  url.searchParams.set("scope", provider.scopes.join(" "));
  url.searchParams.set("state", request.state);
  url.searchParams.set("nonce", request.nonce);
  url.searchParams.set("code_challenge", request.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
