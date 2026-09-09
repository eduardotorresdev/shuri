import type { CollectionStore, Query, RecordId, RecordInput } from "@shuri/store";
import type { CredentialsContext } from "../credentials/signup.js";
import { EmailAlreadyRegisteredError, UserNotFoundError } from "../errors.js";
import type { SessionService } from "../sessions/store.js";
import type { AuthUser } from "../types.js";
import { toPublicUser } from "./public.js";
import { normalizeEmail, type UserService } from "./service.js";
import {
  parseNewUser,
  parseUserPatch,
  type NewUser,
  type UserPatch,
} from "./validate.js";

/** The services user administration is built from — everything a user is spread across. */
export interface UserAdminContext {
  users: UserService;
  sessions: SessionService;
  /** The `_accounts` collection, so removing a user takes their identity links with them. */
  accounts: CollectionStore<RecordInput>;
  credentials: Pick<CredentialsContext, "hasher">;
}

/**
 * Creating, reading, changing and removing users, as an operator does it rather than as a visitor
 * does: no session is issued, no password is required, and the caller is somebody else.
 *
 * Separate from `signUp` for exactly that reason. `signUp` is a *self*-registration — it demands a
 * password and hands back a live session — and reusing it to create somebody else's account would
 * mint a session nobody asked for and leave a `_sessions` row behind for a user who has never
 * signed in.
 */
export interface UserAdminApi {
  /** A page of users, filtered and sorted like any other collection. Never includes `passwordHash`. */
  list(query?: Query): Promise<AuthUser[]>;
  get(id: RecordId): Promise<AuthUser>;
  create(input: NewUser): Promise<AuthUser>;
  update(id: RecordId, patch: UserPatch): Promise<AuthUser>;
  /** Deletes the user, their sessions and their identity links. */
  remove(id: RecordId): Promise<void>;
}

/**
 * Binds user administration to the services a user is spread across: the row itself, the sessions
 * that authenticate it, the links that federate it, and the hasher that protects it.
 *
 * The password never arrives here already hashed and never leaves in any form: `passwordHash` is
 * written only from a plaintext this function hashes, and every value handed back goes through
 * `toPublicUser`, the same schema-derived whitelist the auth routes answer with.
 * @param context - The user, session, account and hashing services.
 * @returns The user administration API.
 */
export function createUserAdmin(context: UserAdminContext): UserAdminApi {
  const { users, sessions, accounts, credentials } = context;

  async function requireUser(id: RecordId): Promise<void> {
    if (!(await users.findById(id))) throw new UserNotFoundError(id);
  }

  /**
   * Refuses an address another user already holds. Check-then-write, so it races exactly as
   * `signUp` does — a real adapter carries a unique index on `users.email`, which is what actually
   * settles it.
   * @param email - The normalized address to claim.
   * @param [exceptId] - The user being updated, which may of course keep its own address.
   * @returns Nothing; throws when the address is taken.
   */
  async function assertEmailFree(email: string, exceptId?: RecordId): Promise<void> {
    const existing = await users.findByEmail(email);
    if (existing && existing.id !== exceptId) throw new EmailAlreadyRegisteredError();
  }

  return {
    async list(query) {
      const records = await users.findMany(query);
      return records.map((record) => toPublicUser(record));
    },

    async get(id) {
      const record = await users.findById(id);
      if (!record) throw new UserNotFoundError(id);
      return toPublicUser(record);
    },

    async create(input) {
      const parsed = parseNewUser(input as unknown as RecordInput);
      await assertEmailFree(normalizeEmail(parsed.email));

      const record = await users.create({
        email: parsed.email,
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.emailVerified === undefined
          ? {}
          : { emailVerified: parsed.emailVerified }),
        // No password is a valid account, not an incomplete one: it signs in through OIDC, or waits
        // for an operator to set one.
        ...(parsed.password === undefined
          ? {}
          : { passwordHash: await credentials.hasher.hash(parsed.password) }),
      });
      return toPublicUser(record);
    },

    async update(id, patch) {
      const parsed = parseUserPatch(patch as unknown as RecordInput);
      await requireUser(id);

      const data: RecordInput = {};
      if (parsed.email !== undefined) {
        const email = normalizeEmail(parsed.email);
        await assertEmailFree(email, id);
        data["email"] = email;
      }
      if (parsed.name !== undefined) data["name"] = parsed.name;
      if (parsed.emailVerified !== undefined)
        data["emailVerified"] = parsed.emailVerified;
      if (parsed.password !== undefined) {
        data["passwordHash"] = await credentials.hasher.hash(parsed.password);
      }

      const record = await users.update(id, data);
      // A new password with the old sessions still live is a reset that resets nothing: whoever the
      // password was changed away from stays signed in until their cookie expires.
      if (parsed.password !== undefined) await sessions.revokeAllForUser(id);
      return toPublicUser(record);
    },

    async remove(id) {
      await requireUser(id);
      // Sessions first, then links, then the row: every order leaves a window, and this is the one
      // whose window is harmless. Deleting the user first would leave, for an instant, sessions
      // whose owner is gone — `resolve` drops those, but only when they are next used.
      await sessions.revokeAllForUser(id);
      const links = await accounts.findMany({
        where: { user: { op: "eq", value: id } },
      });
      for (const link of links) await accounts.delete(link.id);
      await users.delete(id);
    },
  };
}
