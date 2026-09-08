import { expandScopes, type Principal } from "@shuri/core";
import type { CollectionStore, RecordInput, StoreRecord } from "@shuri/store";
import { sha256Base64Url } from "../crypto/digest.js";
import { randomToken } from "../crypto/random.js";
import { InvalidScopeError } from "../errors.js";
import type { Now } from "../types.js";
import { splitList, type AuthClient, type ClientService } from "./service.js";

/**
 * A client token starts with this. The prefix is what lets `resolvePrincipal` pick the table to
 * consult in O(1) — one store read per request, same as a session — and what makes a leaked token
 * recognizable to a secret scanner.
 */
export const CLIENT_TOKEN_PREFIX = "sct_";

/** 1 hour: how long a client token lives. Short on purpose — a client can always ask for another. */
export const DEFAULT_CLIENT_TOKEN_TTL_MS = 60 * 60 * 1000;

/** A token that was just issued, with the one and only copy of its plaintext. */
export interface IssuedClientToken {
  /** The plaintext bearer token. Never stored — only its SHA-256 lives in the store. */
  token: string;
  client: AuthClient;
  /** The concrete scopes the token carries. */
  scope: string[];
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface ClientTokenServiceConfig {
  tokens: CollectionStore<RecordInput>;
  clients: ClientService;
  scopes: readonly string[];
  now: Now;
  ttlMs: number;
}

export interface ClientTokenService {
  /**
   * Issues a token for `client`. `requested` narrows what its roles grant, pattern by pattern; a
   * pattern matching nothing, or a scope the roles don't grant, throws `InvalidScopeError`. The
   * row stores the *patterns* (or nothing, for "everything the roles grant"), not the expansion.
   */
  issue(client: AuthClient, requested?: readonly string[]): Promise<IssuedClientToken>;
  /**
   * The client principal behind a plaintext token, or `undefined`. **May write**: an expired
   * token, or one whose client is gone or revoked, is deleted on the way through. Scopes are
   * expanded **now**, against the current schema and the client's current roles — so a token
   * issued with `posts:*` covers an op added since, and a role trimmed in config shrinks every live
   * token at once, with no reissue.
   */
  resolve(token: string): Promise<Principal | undefined>;
  pruneExpired(): Promise<number>;
}

/**
 * Hashes a client token for lookup and storage — plain SHA-256, for the same reason session tokens
 * use it (see `sessions/tokens.ts`).
 * @param token - The plaintext token.
 * @returns The stored form.
 */
export function hashClientToken(token: string): Promise<string> {
  return sha256Base64Url(token);
}

/**
 * Binds client-token lifecycle to the `_client_tokens` collection.
 * @param config - The collection, the client service, the scope universe, the clock and the TTL.
 * @returns The token service.
 */
export function createClientTokenService(
  config: ClientTokenServiceConfig,
): ClientTokenService {
  const { tokens, clients, now } = config;

  function grant(client: AuthClient, requested?: readonly string[]): string[] {
    const allowed = clients.allowedScopes(client);
    if (requested === undefined) return [...allowed];

    const granted = new Set<string>();
    for (const pattern of requested) {
      const expanded = expandScopes([pattern], config.scopes);
      if (expanded.size === 0) throw new InvalidScopeError(pattern);
      for (const scope of expanded) {
        if (!allowed.has(scope)) throw new InvalidScopeError(scope);
        granted.add(scope);
      }
    }
    return [...granted];
  }

  /**
   * What a stored token carries today: its patterns re-expanded against the current universe, capped
   * by what the client's current roles grant. No pattern stored means "everything the roles grant".
   * @param client - The token's client, as it is now.
   * @param stored - The `scope` column: the requested patterns, space-separated, or absent.
   * @returns The concrete scopes.
   */
  function currentScopes(client: AuthClient, stored: unknown): Set<string> {
    const allowed = clients.allowedScopes(client);
    const patterns = splitList(stored);
    if (patterns.length === 0) return allowed;
    const scopes = new Set<string>();
    for (const scope of expandScopes(patterns, config.scopes)) {
      if (allowed.has(scope)) scopes.add(scope);
    }
    return scopes;
  }

  async function findByToken(
    token: string,
  ): Promise<StoreRecord<RecordInput> | undefined> {
    const tokenHash = await hashClientToken(token);
    const [row] = await tokens.findMany({
      where: { tokenHash: { op: "eq", value: tokenHash } },
      limit: 1,
    });
    return row;
  }

  return {
    async issue(client, requested) {
      const scope = grant(client, requested);
      const token = CLIENT_TOKEN_PREFIX + randomToken();
      const createdAt = now();
      const expiresAt = createdAt + config.ttlMs;
      await tokens.insert({
        tokenHash: await hashClientToken(token),
        client: client.id,
        ...(requested === undefined ? {} : { scope: requested.join(" ") }),
        createdAt,
        expiresAt,
      });
      return { token, client, scope, expiresAt };
    },

    async resolve(token) {
      const row = await findByToken(token);
      if (!row) return undefined;

      if ((row["expiresAt"] as number) <= now()) {
        await tokens.delete(row.id);
        return undefined;
      }

      const client = await clients.get(row["client"] as string);
      if (!client || client.revokedAt !== undefined) {
        await tokens.delete(row.id);
        return undefined;
      }

      return {
        kind: "client",
        client: { id: client.id, name: client.name, clientId: client.clientId },
        scopes: currentScopes(client, row["scope"]),
      };
    },

    async pruneExpired() {
      const expired = await tokens.findMany({
        where: { expiresAt: { op: "lt", value: now() } },
      });
      for (const row of expired) await tokens.delete(row.id);
      return expired.length;
    },
  };
}
