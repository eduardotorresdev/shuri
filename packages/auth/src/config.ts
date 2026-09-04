import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { CollectionStore, RecordInput, Store } from "@shuri/store";
import type { CredentialsContext } from "./credentials/signup.js";
import type { CookieOptions, ResolvedCookieOptions } from "./http/cookie.js";
import { resolveCookieOptions } from "./http/cookie.js";
import type { PasswordHasher } from "./password/hasher.js";
import { createPbkdf2Hasher } from "./password/pbkdf2.js";
import { createSessionCookies, type SessionCookies } from "./sessions/cookie.js";
import {
  createSessionService,
  DEFAULT_RENEW_WITHIN_MS,
  DEFAULT_TTL_MS,
  type SessionService,
} from "./sessions/store.js";
import { AuthConfigError } from "./errors.js";
import { oidcProvider, oidcProviderSlot } from "./oidc/config.js";
import { createDiscovery, type Discovery } from "./oidc/discovery.js";
import { MIN_SECRET_LENGTH, TRANSACTION_COOKIE_NAME } from "./oidc/transaction.js";
import {
  isProviderSlot,
  type OidcProviderSlot,
  type ProviderDeclaration,
  type ResolvedProvider,
} from "./oidc/types.js";
import type { Now } from "./types.js";
import { createUserService, type UserService } from "./users/service.js";

export interface SessionOptions {
  /** How long a session lives from its last renewal, in milliseconds. Defaults to 30 days. */
  ttlMs?: number;
  /**
   * A session read with less than this left is slid forward by a full `ttlMs`. Defaults to 15 days;
   * `0` turns sliding renewal off, making sessions strictly fixed-length.
   */
  renewWithinMs?: number;
}

export interface RedirectOptions {
  /** Where an OIDC login lands when it doesn't ask for anywhere in particular. Defaults to "/". */
  afterSignIn?: string;
  /** Absolute origins a `?redirectTo=` may target, e.g. a separate SPA host. Empty by default. */
  allowedOrigins?: readonly string[];
}

export interface AuthConfig {
  /** Prefix the auth routes are mounted under. Defaults to "/auth". */
  basePath?: string;
  /**
   * Secret signing the short-lived OIDC transaction cookie. At least 32 characters, and **required**
   * once any provider is configured.
   */
  secret?: string;
  cookie?: CookieOptions;
  session?: SessionOptions;
  /** Replaces the default PBKDF2 hasher, e.g. with a Node-side argon2 one. */
  hasher?: PasswordHasher;
  redirects?: RedirectOptions;
  /** Injectable `fetch`, so the OIDC suites run without a network. Defaults to the global one. */
  fetch?: typeof fetch;
  /** Injectable clock, so expiry and renewal are testable. Defaults to `Date.now`. */
  now?: Now;
  /**
   * OIDC providers to offer. Declaring any of them makes `secret` mandatory. Either a fully static
   * `OidcProviderConfig` (its own `clientId`/`clientSecret`/`redirectUri`, resolved once at boot) or
   * a `OidcProviderSlot` (`{ id, preset }`, resolved from `_oidc_credentials` on every sign-in — see
   * `AuthApi.oidcCredentials`).
   */
  providers?: readonly ProviderDeclaration[];
}

/**
 * The one thing `createAuth` needs from the app — the same minimal `Pick<Store, "collection">` shape
 * `@shuri/api`'s handlers take, generic over the declared schema so a `Store<T, G>` from any app
 * satisfies it.
 */
export type CollectionResolver<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> = Pick<Store<T, G>, "collection">;

/** The OIDC half of the context, present only when the host declared a provider. */
export interface OidcRuntime {
  /** Fully static providers, resolved once at boot. */
  providers: Map<string, ResolvedProvider>;
  /** DB-backed providers, resolved from `oidcCredentials` on every sign-in. */
  slots: Map<string, OidcProviderSlot>;
  discovery: Discovery;
  secret: string;
  /** Options for the short-lived transaction cookie, scoped to the OIDC subtree. */
  transactionCookie: ResolvedCookieOptions;
}

/** The resolved services every route in this package is written against. */
export interface AuthContext {
  basePath: string;
  users: UserService;
  sessions: SessionService;
  accounts: CollectionStore<RecordInput>;
  /** The `_oidc_credentials` collection a `OidcProviderSlot` is completed from. */
  oidcCredentials: CollectionStore<RecordInput>;
  credentials: CredentialsContext;
  cookies: SessionCookies;
  cookieOptions: ResolvedCookieOptions;
  redirects: Required<Pick<RedirectOptions, "afterSignIn">> & {
    allowedOrigins: readonly string[];
  };
  now: Now;
  fetch: typeof fetch;
  oidc?: OidcRuntime;
}

function collectionOf(
  store: CollectionResolver<never, never>,
  slug: string,
): CollectionStore<RecordInput> {
  return store.collection(slug as never) as CollectionStore<RecordInput>;
}

/**
 * Resolves the host's config into the services the routes run on: defaults filled in, the three auth
 * collections bound, the cookie configuration resolved once and shared by everything that writes or
 * clears the session cookie.
 * @param store - The app store holding the auth collections.
 * @param config - The host's auth configuration.
 * @returns The resolved context.
 */
export function resolveAuthContext<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(store: CollectionResolver<T, G>, config: AuthConfig): AuthContext {
  const now = config.now ?? Date.now;
  const resolver = store as unknown as CollectionResolver<never, never>;
  const users = createUserService(collectionOf(resolver, "users"), now);
  const sessions = createSessionService({
    sessions: collectionOf(resolver, "_sessions"),
    users,
    now,
    ttlMs: config.session?.ttlMs ?? DEFAULT_TTL_MS,
    renewWithinMs: config.session?.renewWithinMs ?? DEFAULT_RENEW_WITHIN_MS,
  });
  // Resolved once, so the cookie that clears the session is written with exactly the name, path and
  // domain the one that set it used — anything else leaves the original cookie alive.
  const cookieOptions = resolveCookieOptions(config.cookie);
  const basePath = config.basePath ?? "/auth";
  const fetchImpl = config.fetch ?? globalThis.fetch;

  return {
    basePath,
    users,
    sessions,
    accounts: collectionOf(resolver, "_accounts"),
    oidcCredentials: collectionOf(resolver, "_oidc_credentials"),
    credentials: { users, sessions, hasher: config.hasher ?? createPbkdf2Hasher() },
    cookies: createSessionCookies(cookieOptions, now),
    cookieOptions,
    redirects: {
      afterSignIn: config.redirects?.afterSignIn ?? "/",
      allowedOrigins: config.redirects?.allowedOrigins ?? [],
    },
    now,
    fetch: fetchImpl,
    oidc: resolveOidc(config, basePath, cookieOptions, fetchImpl, now),
  };
}

/**
 * Builds the OIDC half of the context, or `undefined` when no provider is declared.
 *
 * The transaction cookie inherits `secure`/`domain` from the session cookie but takes its own name
 * and a `Path` scoped to the OIDC subtree: it is only ever read by the callback, so there is no
 * reason for it to ride along on every request to the app.
 * @param config - The host's auth configuration.
 * @param basePath - The resolved auth base path.
 * @param cookieOptions - The resolved session cookie options, for `secure`/`domain`.
 * @param fetchImpl - The `fetch` discovery and the token exchange use.
 * @param now - The clock.
 * @returns The OIDC runtime, or `undefined` when no provider is declared.
 */
function resolveOidc(
  config: AuthConfig,
  basePath: string,
  cookieOptions: ResolvedCookieOptions,
  fetchImpl: typeof fetch,
  now: Now,
): OidcRuntime | undefined {
  const declared = config.providers ?? [];
  if (declared.length === 0) return undefined;

  const secret = config.secret ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigError(
      `An OIDC provider is configured, so "secret" is required and must be at least ${MIN_SECRET_LENGTH} characters. It signs the short-lived sign-in transaction cookie.`,
    );
  }

  const providers = new Map<string, ResolvedProvider>();
  const slots = new Map<string, OidcProviderSlot>();
  for (const provider of declared) {
    if (isProviderSlot(provider)) {
      const slot = oidcProviderSlot(provider);
      slots.set(slot.id, slot);
    } else {
      const resolved = oidcProvider(provider);
      providers.set(resolved.id, resolved);
    }
  }

  return {
    providers,
    slots,
    secret,
    discovery: createDiscovery(fetchImpl, now),
    transactionCookie: resolveCookieOptions(
      {
        name: TRANSACTION_COOKIE_NAME,
        secure: cookieOptions.secure,
        domain: cookieOptions.domain,
        sameSite: "Lax",
        path: `${basePath}/oidc`,
      },
      TRANSACTION_COOKIE_NAME,
    ),
  };
}
