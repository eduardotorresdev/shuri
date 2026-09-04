import { object, refine, required, validate, type Validator } from "@shuri/validate";
import { OidcProviderError } from "../errors.js";
import type { Now } from "../types.js";
import type { OidcEndpoints, ResolvedProvider } from "./types.js";

/** How long a discovery document is reused before being fetched again. */
export const DISCOVERY_TTL_MS = 60 * 60 * 1000;
/** Every outbound call in this package is bounded: a provider that hangs must not hang our request. */
export const FETCH_TIMEOUT_MS = 10_000;

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

const documentValidator: Validator<DiscoveryDocument> = object<DiscoveryDocument>({
  issuer: required('"issuer" is missing'),
  authorization_endpoint: required('"authorization_endpoint" is missing'),
  token_endpoint: required('"token_endpoint" is missing'),
  userinfo_endpoint: refine<string | undefined>(
    (value) => value === undefined || typeof value === "string",
    '"userinfo_endpoint" must be a string',
  ),
});

export interface Discovery {
  /** The endpoints for `provider`, discovered and cached, or declared inline. */
  endpoints(provider: ResolvedProvider): Promise<OidcEndpoints>;
  /** The issuer identifier an id_token's `iss` must equal. */
  issuer(provider: ResolvedProvider): string | undefined;
}

interface CacheEntry {
  expiresAt: number;
  endpoints: Promise<OidcEndpoints>;
}

/**
 * Resolves and caches provider metadata.
 *
 * Three checks on the fetched document are not optional, and the third is the one that matters most:
 * the `issuer` must equal the configured one (RFC 8414 §3.3), every endpoint must be `https:`, and
 * **every endpoint's origin must equal the issuer's origin**. That last one is the defense against
 * mix-up: a hostile or compromised discovery document whose `token_endpoint` points at another host
 * is precisely how an attacker gets our authorization codes delivered to them.
 *
 * Successes are cached for an hour behind a single-flight promise; failures are never cached, so a
 * provider having a bad minute doesn't lock sign-in out for an hour.
 * @param fetchImpl - The `fetch` to use, injectable for tests.
 * @param now - The clock, for cache expiry.
 * @returns The discovery service.
 */
export function createDiscovery(fetchImpl: typeof fetch, now: Now): Discovery {
  const cache = new Map<string, CacheEntry>();

  async function fetchEndpoints(
    provider: ResolvedProvider,
    issuer: string,
  ): Promise<OidcEndpoints> {
    const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => undefined);

    if (!response?.ok) {
      throw new OidcProviderError(`Discovery failed for provider "${provider.id}"`);
    }

    const document = (await response.json().catch(() => undefined)) as
      DiscoveryDocument | undefined;
    if (!document || validate(document, documentValidator).length > 0) {
      throw new OidcProviderError(
        `Discovery document is malformed for provider "${provider.id}"`,
      );
    }

    if (document.issuer !== issuer) {
      throw new OidcProviderError(
        `Discovery document issuer does not match the configured one for provider "${provider.id}"`,
      );
    }

    const endpoints: OidcEndpoints = {
      authorization: document.authorization_endpoint,
      token: document.token_endpoint,
      userinfo: document.userinfo_endpoint,
    };
    assertSameOrigin(endpoints, issuer, provider.id);
    return endpoints;
  }

  return {
    issuer: (provider) => provider.issuer,

    async endpoints(provider) {
      if (provider.endpoints) return provider.endpoints;
      const { issuer } = provider;
      if (!issuer) {
        throw new OidcProviderError(
          `Provider "${provider.id}" declares neither an issuer nor endpoints`,
        );
      }

      const cached = cache.get(provider.id);
      if (cached && cached.expiresAt > now()) return cached.endpoints;

      const endpoints = fetchEndpoints(provider, issuer);
      cache.set(provider.id, { expiresAt: now() + DISCOVERY_TTL_MS, endpoints });
      // A rejection must not stay cached, or one bad minute locks sign-in out for an hour.
      endpoints.catch(() => cache.delete(provider.id));
      return endpoints;
    },
  };
}

function assertSameOrigin(
  endpoints: OidcEndpoints,
  issuer: string,
  providerId: string,
): void {
  const expected = new URL(issuer).origin;
  for (const endpoint of [endpoints.authorization, endpoints.token, endpoints.userinfo]) {
    if (endpoint === undefined) continue;
    const url = safeUrl(endpoint);
    if (!url || url.protocol !== "https:" || url.origin !== expected) {
      throw new OidcProviderError(
        `Discovery document points outside the issuer's origin for provider "${providerId}"`,
      );
    }
  }
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
