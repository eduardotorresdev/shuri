import {
  all,
  array,
  matches,
  minLength,
  object,
  oneOf,
  optional,
  refine,
  required,
  string,
  validate,
  type Validator,
} from "@shuri/validate";
import { OidcConfigError } from "../errors.js";
import type {
  OidcEndpoints,
  OidcProviderConfig,
  OidcProviderSlot,
  PresetName,
  ResolvedProvider,
} from "./types.js";

export const DEFAULT_SCOPES = ["openid", "email", "profile"] as const;
const PRESET_NAMES: readonly PresetName[] = ["google", "microsoft"];

// Travels in a URL path segment and is stored as `_accounts.provider` and `_oidc_credentials.provider`,
// so it stays to a shape that needs no escaping anywhere.
const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]*$/;

const httpsUrl = (label: string): Validator<unknown> =>
  all(
    string(`"${label}" must be a string`),
    refine<unknown>(
      (value) => typeof value !== "string" || isHttps(value),
      `"${label}" must be an https URL`,
    ),
  );

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const endpointsValidator: Validator<OidcEndpoints> = object<OidcEndpoints>({
  authorization: all(required('"authorization" is required'), httpsUrl("authorization")),
  token: all(required('"token" is required'), httpsUrl("token")),
  userinfo: optional(httpsUrl("userinfo")),
});

// Both confidential-client methods authenticate with the secret — only where they put it differs
// (an Authorization header vs. a body parameter). "none" is the public-client case: no secret at all.
const REQUIRES_CLIENT_SECRET = new Set(["client_secret_basic", "client_secret_post"]);

const providerValidator: Validator<OidcProviderConfig> = all(
  object<OidcProviderConfig>({
    id: all(
      required('"id" is required'),
      string('"id" must be a string'),
      matches(PROVIDER_ID, '"id" must be lowercase letters, digits, "-" or "_"'),
    ),
    clientId: all(
      required('"clientId" is required'),
      string('"clientId" must be a string'),
    ),
    clientSecret: optional(
      all(
        string('"clientSecret" must be a string'),
        minLength(1, '"clientSecret" must not be empty'),
      ),
    ),
    issuer: optional(httpsUrl("issuer")),
    endpoints: optional(endpointsValidator),
    redirectUri: all(
      required('"redirectUri" is required'),
      string('"redirectUri" must be a string'),
    ),
    scopes: optional(
      array<string>(required("a scope must not be empty")) as Validator<
        readonly string[]
      >,
    ),
  }),
  refine<OidcProviderConfig>(
    (config) => Boolean(config.issuer ?? config.endpoints),
    'declare "issuer" (for discovery) or "endpoints"',
  ),
  refine<OidcProviderConfig>(
    (config) =>
      !REQUIRES_CLIENT_SECRET.has(config.tokenAuthMethod as never) ||
      Boolean(config.clientSecret),
    '"tokenAuthMethod" requires a "clientSecret"',
  ),
);

/**
 * Validates a provider declaration and fills in its defaults.
 *
 * `tokenAuthMethod` defaults to `client_secret_basic` when a secret is present and `none` otherwise,
 * because that is the difference between a confidential and a public client — guessing wrong makes
 * the token exchange fail with a message from the provider that explains nothing.
 * @param config - The provider declaration.
 * @returns The resolved provider.
 */
export function oidcProvider(config: OidcProviderConfig): ResolvedProvider {
  const issues = validate(config, providerValidator, `providers.${config.id ?? ""}`);
  if (issues.length > 0) throw new OidcConfigError(issues);

  return {
    id: config.id,
    issuer: config.issuer,
    endpoints: config.endpoints,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: config.scopes ?? DEFAULT_SCOPES,
    redirectUri: config.redirectUri,
    tokenAuthMethod:
      config.tokenAuthMethod ?? (config.clientSecret ? "client_secret_basic" : "none"),
    authorizationParams: config.authorizationParams ?? {},
    allowLinkingByVerifiedEmail: config.allowLinkingByVerifiedEmail ?? true,
    fetchUserInfo: config.fetchUserInfo ?? false,
  };
}

const slotValidator: Validator<OidcProviderSlot> = object<OidcProviderSlot>({
  id: all(
    required('"id" is required'),
    string('"id" must be a string'),
    matches(PROVIDER_ID, '"id" must be lowercase letters, digits, "-" or "_"'),
  ),
  preset: all(
    required('"preset" is required'),
    oneOf(PRESET_NAMES, (value) => `"preset" must be one of ${PRESET_NAMES.join(", ")}, got "${value}"`),
  ),
  scopes: optional(
    array<string>(required("a scope must not be empty")) as Validator<readonly string[]>,
  ),
});

/**
 * Validates a provider slot declaration — the behavior half of a DB-backed provider. Unlike
 * `oidcProvider`, this never touches `clientId`/`clientSecret`/`redirectUri`: those are read from
 * `_oidc_credentials` per request, by `resolveProviderSlot`.
 * @param slot - The slot declaration.
 * @returns The same slot, once it is known to be well-formed.
 */
export function oidcProviderSlot(slot: OidcProviderSlot): OidcProviderSlot {
  const issues = validate(slot, slotValidator, `providers.${slot.id ?? ""}`);
  if (issues.length > 0) throw new OidcConfigError(issues);
  return slot;
}
