import { expandScopes } from "@shuri/core";
import type { CollectionStore, RecordId, RecordInput, StoreRecord } from "@shuri/store";
import { sha256Base64Url } from "../crypto/digest.js";
import { timingSafeEqual } from "../crypto/equal.js";
import { randomToken } from "../crypto/random.js";
import type { Now } from "../types.js";
import { assertKnownRoles } from "./validators.js";

/** A client secret starts with this, so a leaked one is recognizable to a secret scanner. */
export const CLIENT_SECRET_PREFIX = "scs_";

/** A client as this package hands it out: every field but the secret hash. */
export interface AuthClient {
  id: RecordId;
  name: string;
  clientId: string;
  roles: string[];
  createdAt: number;
  revokedAt?: number;
}

/** A client that was just created or rotated, with the one and only copy of its plaintext secret. */
export interface IssuedClient {
  client: AuthClient;
  /** The plaintext secret. Never stored, never recoverable — only its SHA-256 lives in the store. */
  clientSecret: string;
}

export interface CreateClientInput {
  name: string;
  /** Role names from `AuthConfig.clients.roles`. Absent or empty, the client can obtain no scope. */
  roles?: readonly string[];
}

export interface ClientServiceConfig {
  clients: CollectionStore<RecordInput>;
  tokens: CollectionStore<RecordInput>;
  roles: Record<string, readonly string[]>;
  scopes: readonly string[];
  now: Now;
}

export interface ClientService {
  create(input: CreateClientInput): Promise<IssuedClient>;
  list(): Promise<AuthClient[]>;
  get(id: RecordId): Promise<AuthClient | undefined>;
  findByClientId(clientId: string): Promise<AuthClient | undefined>;
  /** Marks the client revoked and deletes every token it holds. Idempotent. */
  revoke(id: RecordId): Promise<void>;
  /** Replaces the secret; tokens already issued stay valid until they expire. */
  rotateSecret(id: RecordId): Promise<IssuedClient>;
  /**
   * The client behind a `client_id`/`client_secret` pair, or `undefined` — for an unknown id, a
   * revoked client and a wrong secret alike, after the same amount of work.
   */
  verify(clientId: string, clientSecret: string): Promise<AuthClient | undefined>;
  /** Every concrete scope the client's roles grant, expanded against the schema's scopes. */
  allowedScopes(client: AuthClient): Set<string>;
}

/**
 * Projects a stored `_clients` row onto `AuthClient`, dropping the secret hash.
 * @param record - The stored row.
 * @returns The client.
 */
export function toClient(record: StoreRecord<RecordInput>): AuthClient {
  const revokedAt = record["revokedAt"];
  return {
    id: record.id,
    name: record["name"] as string,
    clientId: record["clientId"] as string,
    roles: splitList(record["roles"]),
    createdAt: record["createdAt"] as number,
    ...(typeof revokedAt === "number" ? { revokedAt } : {}),
  };
}

/**
 * Splits a space-separated list — the shape both `_clients.roles` and `_client_tokens.scope` use.
 * @param value - The stored text, or anything else (treated as empty).
 * @returns The non-empty entries.
 */
export function splitList(value: unknown): string[] {
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

/**
 * Binds client management to the `_clients` and `_client_tokens` collections.
 * @param config - The collections, the declared roles, the scope universe and the clock.
 * @returns The client service.
 */
export function createClientService(config: ClientServiceConfig): ClientService {
  const { clients, tokens, now } = config;
  const knownRoles = Object.keys(config.roles);

  async function issueSecret(): Promise<{ clientSecret: string; secretHash: string }> {
    const clientSecret = CLIENT_SECRET_PREFIX + randomToken();
    return { clientSecret, secretHash: await sha256Base64Url(clientSecret) };
  }

  async function findRow(
    clientId: string,
  ): Promise<StoreRecord<RecordInput> | undefined> {
    const [row] = await clients.findMany({
      where: { clientId: { op: "eq", value: clientId } },
      limit: 1,
    });
    return row;
  }

  return {
    async create(input) {
      const roles = input.roles ?? [];
      assertKnownRoles(roles, knownRoles);
      const { clientSecret, secretHash } = await issueSecret();
      const record = await clients.insert({
        name: input.name,
        clientId: randomToken(16),
        secretHash,
        roles: roles.join(" "),
        createdAt: now(),
      });
      return { client: toClient(record), clientSecret };
    },

    async list() {
      const rows = await clients.findMany({
        orderBy: [{ field: "createdAt", direction: "asc" }],
      });
      return rows.map(toClient);
    },

    async get(id) {
      const row = await clients.findOne(id);
      return row ? toClient(row) : undefined;
    },

    async findByClientId(clientId) {
      const row = await findRow(clientId);
      return row ? toClient(row) : undefined;
    },

    async revoke(id) {
      const row = await clients.get(id);
      if (row["revokedAt"] === undefined) await clients.update(id, { revokedAt: now() });
      const held = await tokens.findMany({ where: { client: { op: "eq", value: id } } });
      for (const token of held) await tokens.delete(token.id);
    },

    async rotateSecret(id) {
      const { clientSecret, secretHash } = await issueSecret();
      const record = await clients.update(id, { secretHash });
      return { client: toClient(record), clientSecret };
    },

    async verify(clientId, clientSecret) {
      const row = await findRow(clientId);
      // The digest is computed and compared either way, so an unknown id costs what a wrong secret does.
      const presented = await sha256Base64Url(clientSecret);
      const stored = typeof row?.["secretHash"] === "string" ? row["secretHash"] : "";
      const matches = timingSafeEqual(presented, stored);
      if (!row || !matches || row["revokedAt"] !== undefined) return undefined;
      return toClient(row);
    },

    allowedScopes(client) {
      const patterns = client.roles.flatMap((role) => config.roles[role] ?? []);
      return expandScopes(patterns, config.scopes);
    },
  };
}
