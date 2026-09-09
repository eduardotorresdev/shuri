import { expandScopes, type Principal } from "@shuri/core";

/**
 * A verified key as `@better-auth/api-key` hands it back, narrowed to what a principal is built
 * from. `referenceId` is the owner — a user, or an organization when the plugin is configured so.
 */
export interface VerifiedApiKey {
  id: string;
  name: string | null;
  referenceId: string;
  permissions?: Record<string, string[]> | null | undefined;
  metadata: Record<string, unknown> | null;
}

/** What a host says when minting a key: `@better-auth/api-key`'s own `createApiKey` body, narrowed. */
export interface IssueApiKeyInput {
  /** The owner: the user (or organization) the key acts on behalf of. */
  userId: string;
  name?: string;
  /** `{ resource: [action] }`, e.g. `{ posts: ["list", "view"], site: ["*"] }`. */
  permissions?: Record<string, string[]>;
  /** Seconds until the key expires; `null` (the default) never does. */
  expiresIn?: number | null;
  /** Uses left before the key stops working; `null` (the default) is unlimited. */
  remaining?: number | null;
  refillAmount?: number;
  refillInterval?: number;
  rateLimitEnabled?: boolean;
  rateLimitMax?: number;
  rateLimitTimeWindow?: number;
  prefix?: string;
  /** Free-form, stored with the key and carried on the principal as `client.metadata`. Needs `enableMetadata`. */
  metadata?: Record<string, unknown>;
}

/** A freshly minted key: the only time the plaintext `key` is ever readable. */
export interface IssuedApiKey {
  id: string;
  key: string;
  name: string | null;
  expiresAt: Date | null;
}

/** The slice of a better-auth instance this file calls; both exist once the plugin is on. */
export interface BetterAuthApiKeyApi {
  api: {
    verifyApiKey?: (input: {
      body: { key: string };
    }) => Promise<{ valid: boolean; key: VerifiedApiKey | null }>;
    createApiKey?: (input: { body: IssueApiKeyInput }) => Promise<IssuedApiKey>;
  };
}

/** Mints keys on the server's behalf — a seed, an admin action, a CLI. */
export interface ApiKeyIssuer {
  create(input: IssueApiKeyInput): Promise<IssuedApiKey>;
}

/** `@better-auth/api-key` is not among better-auth's plugins, so there is nothing to mint or verify. */
export class ApiKeysNotEnabledError extends Error {
  constructor() {
    super(
      "API keys are not enabled: add `apiKey()` from `@better-auth/api-key` to better-auth's " +
        "`plugins` to mint or verify one.",
    );
    this.name = "ApiKeysNotEnabledError";
  }
}

/** Where a key may arrive: `x-api-key` is `@better-auth/api-key`'s own default. */
export const DEFAULT_API_KEY_HEADERS: readonly string[] = ["x-api-key"];

/** Resolves a request to the client behind its key, or nothing when it carries no valid key. */
export type ApiKeyResolver = (request: Request) => Promise<Principal | undefined>;

export interface ApiKeyResolverOptions {
  /** The headers a key may arrive in, checked in order; `Authorization: Bearer` is always accepted after them. */
  headers?: readonly string[] | undefined;
  /** Every concrete scope the schema defines (`derivedScopes`): what a `*` permission expands within. */
  universe: readonly string[];
}

/**
 * The key a request carries: the first of `headers` that is set, else a bearer token. The bearer
 * form is what `@shuri/client`'s `setToken` sends, and what a script already knows how to send.
 * @param request - The incoming request.
 * @param headers - The header names to look in, in order.
 * @returns The key, or `undefined` when the request carries none.
 */
export function apiKeyFrom(
  request: Request,
  headers: readonly string[] = DEFAULT_API_KEY_HEADERS,
): string | undefined {
  for (const name of headers) {
    const value = request.headers.get(name)?.trim();
    if (value) return value;
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  return bearer?.trim() || undefined;
}

/**
 * Turns a key's permissions into the scopes `@shuri/core`'s policy checks.
 *
 * `@better-auth/api-key` stores permissions as `{ resource: [action] }`; a scope is `resource:action`
 * (`posts:list`), so the mapping is one to one, and `*` on either side is a pattern
 * `expandScopes` resolves against the schema — `{ posts: ["*"] }` is every op on `posts`,
 * `{ "*": ["list", "view"] }` is reading everything. Expanded once here, at resolution, so the
 * policy only ever asks `has()`. A resource the schema doesn't serve expands to nothing: a key
 * can't be granted what doesn't exist.
 * @param permissions - The key's permissions, as stored.
 * @param universe - The concrete scopes that exist.
 * @returns The scopes the key carries.
 */
export function permissionsToScopes(
  permissions: Record<string, string[]> | null | undefined,
  universe: readonly string[],
): Set<string> {
  const patterns: string[] = [];
  for (const [resource, actions] of Object.entries(permissions ?? {})) {
    for (const action of actions) patterns.push(`${resource}:${action}`);
  }
  return expandScopes(patterns, universe);
}

/**
 * The principal a verified key stands for: a `client`, never a `user`. The key's owner is not
 * signed in — a script holding the key is acting in its own name, with exactly the scopes it was
 * granted and none of the owner's standing — which is the whole point of a machine credential.
 * @param key - The verified key.
 * @param universe - The concrete scopes that exist.
 * @returns The client principal.
 */
export function toApiKeyPrincipal(
  key: VerifiedApiKey,
  universe: readonly string[],
): Principal {
  return {
    kind: "client",
    client: {
      id: key.id,
      name: key.name ?? key.id,
      referenceId: key.referenceId,
      metadata: key.metadata ?? {},
    },
    scopes: permissionsToScopes(key.permissions, universe),
  };
}

/**
 * Builds the resolver that turns an API key into a client principal, through
 * `@better-auth/api-key`'s own `verifyApiKey` — so expiry, `enabled`, `remaining` and rate limits
 * are all its call, and every request counts against them as it should.
 *
 * Never throws, and answers `undefined` for anything that isn't a valid key — a missing header,
 * a revoked key, a bearer that is really a session token — so the session resolution runs next.
 * Without the plugin in better-auth's options there is no `verifyApiKey`, and the resolver is a
 * constant `undefined`.
 * @param auth - The built better-auth instance.
 * @param options - The headers to read, and the scope universe.
 * @returns The resolver.
 */
export function createApiKeyResolver(
  auth: BetterAuthApiKeyApi,
  options: ApiKeyResolverOptions,
): ApiKeyResolver {
  const verify = auth.api.verifyApiKey;
  if (typeof verify !== "function") return async () => undefined;
  const headers = options.headers ?? DEFAULT_API_KEY_HEADERS;

  return async function resolveApiKey(request) {
    const key = apiKeyFrom(request, headers);
    if (!key) return undefined;
    try {
      const result = await verify({ body: { key } });
      return result.valid && result.key
        ? toApiKeyPrincipal(result.key, options.universe)
        : undefined;
    } catch {
      return undefined;
    }
  };
}

/**
 * Builds the server-side issuer over `@better-auth/api-key`'s `createApiKey`, which hashes the key
 * before storing it and hands the plaintext back exactly once. The plugin's own HTTP route does the
 * same for a signed-in user minting their own key; this is for the host doing it in code.
 * @param auth - The built better-auth instance.
 * @returns The issuer.
 */
export function createApiKeyIssuer(auth: BetterAuthApiKeyApi): ApiKeyIssuer {
  return {
    async create(input) {
      const mint = auth.api.createApiKey;
      if (typeof mint !== "function") throw new ApiKeysNotEnabledError();
      return mint({ body: input });
    },
  };
}
