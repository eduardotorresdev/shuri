import type { FallingHandler } from "@shuri/api";
import type { CollectionSchema, GlobalSchema, Principal } from "@shuri/core";
import type { CollectionStore, RecordId, RecordInput } from "@shuri/store";
import { AUTH_SLUGS } from "./collections.js";
import type { ClientService } from "./clients/service.js";
import type { IssuedClientToken } from "./clients/tokens.js";
import {
  resolveAuthContext,
  type CollectionResolver,
  type ResolveAuthOptions,
} from "./config.js";
import { signIn } from "./credentials/login.js";
import { signUp } from "./credentials/signup.js";
import {
  AuthSlugCollisionError,
  UnauthenticatedError,
  UnknownClientError,
} from "./errors.js";
import { authOpenApi, type AuthOpenApi } from "./docs/openapi.js";
import { resolvePrincipal } from "./principal.js";
import { createAuthHandler } from "./routes/handler.js";
import { createUserAdmin, type UserAdminApi } from "./users/admin.js";
import type {
  AuthSession,
  Credentials,
  IssuedSession,
  SessionMetadata,
} from "./types.js";

/**
 * The programmatic surface, alongside the HTTP one. Everything a host needs to guard its own routes,
 * run a cron, or drive the flows from a script.
 */
export interface AuthApi {
  /** The falling handler serving every auth route; `undefined` for anything outside `basePath`. */
  handler: FallingHandler;
  /**
   * Resolves the session behind a request, from `Authorization: Bearer` or the cookie.
   *
   * **May write.** Expiry is lazy, so reading an expired or orphaned session deletes its row, and a
   * session inside the renewal window is slid forward.
   */
  getSession(request: Request): Promise<AuthSession | undefined>;
  /** Like `getSession`, but throws `UnauthenticatedError` instead of resolving to `undefined`. */
  requireSession(request: Request): Promise<AuthSession>;
  /**
   * Who is behind a request, for `@shuri/api`'s access guards: a client for an `sct_` bearer token,
   * a user for a session (bearer or cookie), anonymous otherwise. Like `getSession`, may write.
   */
  principal(request: Request): Promise<Principal>;
  /**
   * The client-credentials clients: create (the secret is returned once), list, get, revoke,
   * rotate. Programmatic only this round, like `oidcCredentials`: wire it behind the host's own
   * authenticated admin route.
   */
  clients: ClientService;
  /**
   * Issues a client token without going through `POST /auth/token` — for a script, a cron or a
   * test. `scopes` narrows the client's roles; absent, the token carries everything they grant.
   */
  issueClientToken(
    clientId: string,
    scopes?: readonly string[],
  ): Promise<IssuedClientToken>;
  /** Deletes every expired client token row and reports how many. For a host's cron, like `pruneExpiredSessions`. */
  pruneExpiredClientTokens(): Promise<number>;
  /** This package's routes and security schemes, for `createOpenApiHandler`'s `paths`/`security`. */
  openapi: AuthOpenApi;
  /**
   * The `_oidc_credentials` collection: one row per `OidcProviderSlot` declared in `providers`,
   * holding the `clientId`/`clientSecret`/`redirectUri` (and, for `microsoft`, `tenant`) an admin
   * fills in — that's what lets a preset be "configure the keys and it works" instead of a redeploy.
   * `internal: true`, so this is the only way to reach it; wire it up behind the host's own
   * authenticated admin route, never the public REST surface.
   */
  oidcCredentials: CollectionStore<RecordInput>;
  /**
   * Creating, reading, changing and removing users as an *operator* — the admin's Users screen runs
   * on this. Separate from `signUp`, which is self-registration: that one demands a password and
   * hands back a session, neither of which makes sense when the caller is somebody else.
   *
   * `users` is `internal: true`, so this is the only way in. Wire it behind an authenticated route
   * of your own — never the public REST surface, which is exactly what `internal` is keeping it off.
   */
  users: UserAdminApi;
  signUp(input: Credentials, meta?: SessionMetadata): Promise<IssuedSession>;
  signIn(input: Credentials, meta?: SessionMetadata): Promise<IssuedSession>;
  signOut(token: string): Promise<void>;
  createSession(userId: RecordId, meta?: SessionMetadata): Promise<IssuedSession>;
  /** The `Set-Cookie` value for a session, for a host issuing one from its own route. */
  sessionCookie(token: string, expiresAt: number): string;
  /** The `Set-Cookie` value that clears it, built from the same resolved options. */
  clearSessionCookie(): string;
  /**
   * Deletes every expired session row and reports how many. For a host's cron — this package never
   * schedules anything itself, since a live interval holds the event loop (and every `vitest run`)
   * open.
   */
  pruneExpiredSessions(): Promise<number>;
}

export interface CreateAuthConfig<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> extends ResolveAuthOptions {
  /** The app store holding the auth collections. Structurally the same shape `@shuri/api`'s handlers take. */
  store: CollectionResolver<T, G>;
}

/**
 * Fails `create()` when a consumer collection reuses a slug this package owns, naming the owner
 * instead of letting `createCore` report an opaque duplicate-slug issue.
 * @param collections - The consumer's own collections.
 * @returns Nothing; throws `AuthSlugCollisionError` on the first collision.
 */
export function assertNoAuthSlugCollision(
  collections: readonly { slug: string }[],
): void {
  for (const collection of collections) {
    if (AUTH_SLUGS.includes(collection.slug)) {
      throw new AuthSlugCollisionError(collection.slug);
    }
  }
}

/**
 * Builds the auth service over an existing store.
 *
 * Takes `store`, not an app: `@shuri/auth` is deliberately two separable things — a static constant
 * of schemas (`authCollections`, depending on nothing) and this service bound to a store. That is
 * what dissolves the apparent circularity in `@shuri/sdk`'s `create()`, where the handler needs the
 * store, the store needs the core, and the core needs these collections.
 * @param config - The store plus the host's auth configuration.
 * @returns The auth API.
 */
export function createAuth<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
>(config: CreateAuthConfig<T, G>): AuthApi {
  const context = resolveAuthContext(config.store, config);

  async function getSession(request: Request): Promise<AuthSession | undefined> {
    const token = context.cookies.read(request);
    return token ? context.sessions.resolve(token) : undefined;
  }

  return {
    handler: createAuthHandler(context),
    getSession,
    principal: (request) => resolvePrincipal(context, request),
    openapi: authOpenApi(context),
    oidcCredentials: context.oidcCredentials,
    clients: context.clients,
    users: createUserAdmin(context),

    async requireSession(request) {
      const session = await getSession(request);
      if (!session) throw new UnauthenticatedError();
      return session;
    },

    signUp: (input, meta) => signUp(context.credentials, input, meta),
    signIn: (input, meta) => signIn(context.credentials, input, meta),
    signOut: (token) => context.sessions.revoke(token),
    createSession: (userId, meta) => context.sessions.create(userId, meta),
    sessionCookie: (token, expiresAt) => context.cookies.issue(token, expiresAt),
    clearSessionCookie: () => context.cookies.clear(),
    pruneExpiredSessions: () => context.sessions.pruneExpired(),

    async issueClientToken(clientId, scopes) {
      const client = await context.clients.findByClientId(clientId);
      if (!client || client.revokedAt !== undefined)
        throw new UnknownClientError(clientId);
      return context.clientTokens.issue(client, scopes);
    },
    pruneExpiredClientTokens: () => context.clientTokens.pruneExpired(),
  };
}
