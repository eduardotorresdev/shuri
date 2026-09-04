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

/** The presets that can back a `OidcProviderSlot`. */
export type PresetName = "google" | "microsoft";

/**
 * A provider whose *behavior* (which preset, which scopes, ...) is fixed in code but whose
 * *credentials* are admin-managed data, read from `_oidc_credentials` at request time. This is what
 * lets "the user configures the keys and it works" hold: the host declares the slot once, and an
 * admin fills in `clientId`/`clientSecret`/`redirectUri` (and, for `microsoft`, `tenant`) without a
 * redeploy.
 */
export interface OidcProviderSlot {
  /** Also the row's `provider` in `_oidc_credentials`, and the id in the route path. */
  id: string;
  preset: PresetName;
  /** Defaults to `["openid", "email", "profile"]`. */
  scopes?: readonly string[];
  tokenAuthMethod?: TokenAuthMethod;
  authorizationParams?: Record<string, string>;
  allowLinkingByVerifiedEmail?: boolean;
  fetchUserInfo?: boolean;
}

/**
 * One provider declaration: either a fully static `OidcProviderConfig` (its own `clientId` etc.,
 * resolved once at boot) or a `OidcProviderSlot` (credentials resolved from `_oidc_credentials` on
 * every sign-in). Distinguished structurally — a slot never has `clientId`, a static config always
 * does — so no extra discriminant tag is needed.
 */
export type ProviderDeclaration = OidcProviderConfig | OidcProviderSlot;

/**
 * Narrows a `ProviderDeclaration` to a `OidcProviderSlot`.
 * @param declared - The provider declaration.
 * @returns Whether it is a slot rather than a static config.
 */
export function isProviderSlot(
  declared: ProviderDeclaration,
): declared is OidcProviderSlot {
  return !("clientId" in declared);
}

/** The `_oidc_credentials` row shape a `OidcProviderSlot` is completed from. */
export interface OidcProviderCredentials {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  /** Azure AD tenant; read only for a `preset: "microsoft"` slot. */
  tenant?: string;
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
