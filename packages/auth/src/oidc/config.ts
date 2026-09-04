import {
  all,
  array,
  matches,
  minLength,
  object,
  optional,
  refine,
  required,
  string,
  validate,
  type Validator,
} from "@shuri/validate";
import { OidcConfigError } from "../errors.js";
import type { OidcEndpoints, OidcProviderConfig, ResolvedProvider } from "./types.js";

export const DEFAULT_SCOPES = ["openid", "email", "profile"] as const;

// Travels in a URL path segment and is stored as `_accounts.provider`, so it stays to a shape that
// needs no escaping anywhere.
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
      config.tokenAuthMethod !== "client_secret_basic" || Boolean(config.clientSecret),
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
