/** The endpoints a provider is driven through, either declared by the host or discovered. */
export interface OidcEndpoints {
  authorization: string;
  token: string;
  userinfo?: string;
}

export type TokenAuthMethod = "client_secret_basic" | "client_secret_post" | "none";

export interface OidcProviderConfig {
  /** Stable id, used in the route path (`/auth/oidc/:id`) and stored on `_accounts.provider`. */
  id: string;
  /** Base issuer URL; enables discovery. Give this **or** `endpoints`. */
  issuer?: string;
  /** Explicit endpoints, for a provider without a discovery document. */
  endpoints?: OidcEndpoints;
  clientId: string;
  clientSecret?: string;
  /** Defaults to `["openid", "email", "profile"]`. */
  scopes?: readonly string[];
  /** Must match, byte for byte, what is registered with the provider. */
  redirectUri: string;
  /** Defaults to `client_secret_basic` when a secret is set, `none` otherwise (a public client). */
  tokenAuthMethod?: TokenAuthMethod;
  /** Extra authorization-request parameters, e.g. `{ prompt: "consent" }`. */
  authorizationParams?: Record<string, string>;
  /**
   * Whether an identity whose email the provider marked verified may link to an existing local user
   * with that address. Defaults to `true`; an unverified email never links (see `link.ts`).
   */
  allowLinkingByVerifiedEmail?: boolean;
  /** Whether to call the userinfo endpoint for claims the id_token didn't carry. Defaults to `false`. */
  fetchUserInfo?: boolean;
}

/** A provider declaration with every default filled in. */
export interface ResolvedProvider {
  id: string;
  issuer?: string;
  endpoints?: OidcEndpoints;
  clientId: string;
  clientSecret?: string;
  scopes: readonly string[];
  redirectUri: string;
  tokenAuthMethod: TokenAuthMethod;
  authorizationParams: Record<string, string>;
  allowLinkingByVerifiedEmail: boolean;
  fetchUserInfo: boolean;
}

/** The claims this package reads off an id_token (or userinfo). */
export interface IdTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  azp?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  [claim: string]: unknown;
}
