import { OidcProviderError } from "../errors.js";
import { FETCH_TIMEOUT_MS } from "./discovery.js";
import type { OidcEndpoints, ResolvedProvider } from "./types.js";

export interface TokenResponse {
  id_token?: string;
  access_token?: string;
  token_type?: string;
}

/**
 * Redeems an authorization code at the token endpoint.
 *
 * This exchange is what licenses the id_token handling in `id-token.ts` to skip signature
 * verification: *we* hold the code, *we* make this request, over TLS to a URL whose origin was
 * checked against the issuer's, with `fetch` validating the certificate. OIDC Core 3.1.3.7 item 6
 * allows exactly that substitution.
 * @param fetchImpl - The `fetch` to use.
 * @param endpoints - The provider's resolved endpoints.
 * @param provider - The resolved provider.
 * @param code - The authorization code from the callback.
 * @param verifier - The PKCE verifier from the transaction cookie.
 * @returns The token response.
 */
export async function exchangeCode(
  fetchImpl: typeof fetch,
  endpoints: OidcEndpoints,
  provider: ResolvedProvider,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: provider.redirectUri,
    client_id: provider.clientId,
    code_verifier: verifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };

  if (provider.tokenAuthMethod === "client_secret_post" && provider.clientSecret) {
    body.set("client_secret", provider.clientSecret);
  }
  if (provider.tokenAuthMethod === "client_secret_basic" && provider.clientSecret) {
    const credentials = `${encodeURIComponent(provider.clientId)}:${encodeURIComponent(provider.clientSecret)}`;
    headers["authorization"] = `Basic ${btoa(credentials)}`;
  }

  const response = await fetchImpl(endpoints.token, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => undefined);

  if (!response?.ok) {
    // The provider's own `error_description` is deliberately not read or reflected: it is
    // attacker-influenced text that would land verbatim in our response body.
    throw new OidcProviderError("The token exchange was rejected");
  }

  const tokens = (await response.json().catch(() => undefined)) as
    TokenResponse | undefined;
  if (!tokens?.id_token) {
    throw new OidcProviderError("The token response carried no id_token");
  }
  return tokens;
}
