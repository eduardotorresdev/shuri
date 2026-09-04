import type { CollectionStore, RecordId, RecordInput, StoreRecord } from "@shuri/store";
import { toPublicUser } from "../users/public.js";
import type { UserService } from "../users/service.js";
import type { AuthSession, IssuedSession, Now, SessionMetadata } from "../types.js";
import { hashSessionToken, issueSessionToken } from "./tokens.js";

/** 30 days: how long a session lives from its last renewal. */
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 15 days: a session read with less than this left is slid forward. `0` disables renewal. */
export const DEFAULT_RENEW_WITHIN_MS = 15 * 24 * 60 * 60 * 1000;

export interface SessionServiceConfig {
  sessions: CollectionStore<RecordInput>;
  users: UserService;
  now: Now;
  ttlMs: number;
  renewWithinMs: number;
}

export interface SessionService {
  create(userId: RecordId, meta?: SessionMetadata): Promise<IssuedSession>;
  /**
   * Resolves a plaintext token to a live session, **and may write**: an expired or orphaned row is
   * deleted on the way through, and a session close to expiry is slid forward.
   */
  resolve(token: string): Promise<AuthSession | undefined>;
  revoke(token: string): Promise<void>;
  pruneExpired(): Promise<number>;
}

/**
 * Binds session lifecycle to the `_sessions` collection.
 *
 * Lookup is a single `findMany` with an `eq` filter on `tokenHash`, deliberately: in the memory
 * adapter `eq` is strict `===` and never reaches `compare`, which only understands
 * number/string/boolean and answers "equal" (matching everything) for anything else. Expiry is then
 * checked in memory rather than in the `where`, which also keeps the hot path to one query.
 *
 * There is no sweeper interval anywhere in this package: sessions expire lazily on read, and
 * `pruneExpired` is offered for a host's own cron. An interval would hold the event loop open for
 * every `vitest run` that ever built an app.
 * @param config - The collection, user service, clock and lifetimes.
 * @returns The session service.
 */
export function createSessionService(config: SessionServiceConfig): SessionService {
  const { sessions, users, now } = config;

  async function findByToken(
    token: string,
  ): Promise<StoreRecord<RecordInput> | undefined> {
    const tokenHash = await hashSessionToken(token);
    const [session] = await sessions.findMany({
      where: { tokenHash: { op: "eq", value: tokenHash } },
      limit: 1,
    });
    return session;
  }

  return {
    async create(userId, meta = {}) {
      const { token, tokenHash } = await issueSessionToken();
      const createdAt = now();
      const record = await sessions.insert({
        tokenHash,
        user: userId,
        createdAt,
        expiresAt: createdAt + config.ttlMs,
        ...(meta.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
        ...(meta.ip === undefined ? {} : { ip: meta.ip }),
      });

      const user = await users.findById(userId);
      if (!user) throw new Error(`Cannot create a session for unknown user "${userId}"`);

      const publicUser = toPublicUser(user);
      return {
        token,
        user: publicUser,
        session: {
          id: record.id,
          user: publicUser,
          expiresAt: record["expiresAt"] as number,
          renewed: false,
        },
      };
    },

    async resolve(token) {
      const record = await findByToken(token);
      if (!record) return undefined;

      const expiresAt = record["expiresAt"] as number;
      if (expiresAt <= now()) {
        await sessions.delete(record.id);
        return undefined;
      }

      const user = await users.findById(record["user"] as RecordId);
      if (!user) {
        // The owner is gone; a session outliving its user is a credential nobody can revoke.
        await sessions.delete(record.id);
        return undefined;
      }

      const renewed =
        config.renewWithinMs > 0 && expiresAt - now() < config.renewWithinMs;
      const nextExpiresAt = renewed ? now() + config.ttlMs : expiresAt;
      if (renewed) await sessions.update(record.id, { expiresAt: nextExpiresAt });

      return {
        id: record.id,
        user: toPublicUser(user),
        expiresAt: nextExpiresAt,
        renewed,
      };
    },

    async revoke(token) {
      const record = await findByToken(token);
      if (record) await sessions.delete(record.id);
    },

    async pruneExpired() {
      const expired = await sessions.findMany({
        where: { expiresAt: { op: "lt", value: now() } },
      });
      for (const record of expired) await sessions.delete(record.id);
      return expired.length;
    },
  };
}
