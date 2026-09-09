import type { CollectionStore, Query, RecordId, RecordInput } from "@shuri/store";
import type {
  AdminUserPatch,
  AdminUserRecord,
  NewAdminUser,
  UserAdminApi,
} from "@shuri/ui";
import type { BetterAuthInstance } from "./plugin.js";
import { EmailAlreadyRegisteredError, UserNotFoundError } from "./errors.js";
import { toAdminSessionUser } from "./session.js";

/** The slice of `@shuri/store` this needs: reading the user table the way any list is read. */
export interface UsersCollectionResolver {
  collection(slug: string): CollectionStore<RecordInput>;
}

/** better-auth's own name for a password-backed account, on the `account` row that holds the hash. */
const CREDENTIAL_PROVIDER = "credential";

/**
 * User administration over better-auth, for `@shuri/ui`'s Users screens.
 *
 * Reads go through the app's own store — the user table is a Shuri collection, so `list` speaks the
 * same `Query` every other list does, filters and sorting included. Writes go through better-auth's
 * internal adapter, so a password is hashed by better-auth's own hasher and lands on the `account`
 * row its sign-in reads, and creating an account runs whatever `user` hooks the host configured.
 *
 * A password never arrives here already hashed and never leaves in any form: it lives on the
 * `account` row, which is not the one these methods return.
 * @param auth - The built better-auth instance.
 * @param store - The store holding better-auth's tables.
 * @param userModel - The user table's slug, "user" unless the host renamed it.
 * @returns The user administration API to hand the admin.
 */
export function createBetterAuthUsers(
  auth: BetterAuthInstance,
  store: UsersCollectionResolver,
  userModel = "user",
): UserAdminApi {
  const users = () => store.collection(userModel);

  /**
   * Reads a user row, refusing an id that names nobody.
   * @param id - The user's id.
   * @returns The user, in the admin's shape.
   */
  async function requireUser(id: RecordId): Promise<AdminUserRecord> {
    const row = await users().findOne(id);
    if (!row) throw new UserNotFoundError(id);
    return toAdminUserRecord(row);
  }

  /**
   * Refuses an address another account already holds. better-auth's adapters don't all enforce
   * uniqueness on `email`, and a duplicate would make sign-in ambiguous for both accounts.
   * @param email - The address about to be written.
   * @param [ownerId] - The account that may already hold it, when renaming.
   */
  async function assertEmailFree(email: string, ownerId?: RecordId): Promise<void> {
    const { internalAdapter } = await auth.$context;
    const existing = await internalAdapter.findUserByEmail(email);
    if (existing && existing.user.id !== ownerId)
      throw new EmailAlreadyRegisteredError(email);
  }

  return {
    async list(query?: Query) {
      return (await users().findMany(query ?? {})).map(toAdminUserRecord);
    },

    get: requireUser,

    async create(input: NewAdminUser) {
      const { internalAdapter, password } = await auth.$context;
      await assertEmailFree(input.email);

      const created = await internalAdapter.createUser(
        {
          email: input.email,
          // better-auth requires a name; the address stands in until the user sets one.
          name: input.name ?? input.email,
          emailVerified: input.emailVerified ?? false,
        },
        { method: "admin" },
      );
      // No password is a valid account, not an incomplete one: it signs in through a social
      // provider, or waits for an operator to set one.
      if (input.password !== undefined) {
        await internalAdapter.linkAccount({
          userId: created.id,
          providerId: CREDENTIAL_PROVIDER,
          accountId: created.id,
          password: await password.hash(input.password),
        });
      }
      return requireUser(created.id);
    },

    async update(id: RecordId, patch: AdminUserPatch) {
      const { internalAdapter, password } = await auth.$context;
      await requireUser(id);
      const { password: newPassword, ...fields } = patch;
      if (fields.email !== undefined) await assertEmailFree(fields.email, id);

      if (Object.keys(fields).length > 0) await internalAdapter.updateUser(id, fields);
      if (newPassword !== undefined) {
        const hash = await password.hash(newPassword);
        const credential = await internalAdapter.findCredentialAccount(id);
        if (credential) {
          await internalAdapter.updatePassword(id, hash);
        } else {
          await internalAdapter.linkAccount({
            userId: id,
            providerId: CREDENTIAL_PROVIDER,
            accountId: id,
            password: hash,
          });
        }
        // A reset that leaves the old cookies working resets nothing.
        await internalAdapter.deleteUserSessions(id);
      }
      return requireUser(id);
    },

    async remove(id: RecordId) {
      const { internalAdapter } = await auth.$context;
      await requireUser(id);
      // Sessions first, then the identity links, then the row: the reverse would leave, for an
      // instant, sessions whose owner is gone.
      await internalAdapter.deleteUserSessions(id);
      await internalAdapter.deleteAccounts(id);
      await internalAdapter.deleteUser(id);
    },
  };
}

/**
 * Projects a user row onto the admin's shape. Nothing on the user table is secret — the password
 * lives on `account` — so this only normalises `name` and guarantees the two required fields.
 * @param row - The row as the store returned it.
 * @returns The user as the admin lists it.
 */
function toAdminUserRecord(row: RecordInput & { id: RecordId }): AdminUserRecord {
  const user = toAdminSessionUser({
    ...row,
    id: row.id,
    email: typeof row["email"] === "string" ? row["email"] : "",
  });
  const verified = row["emailVerified"];
  return {
    ...user,
    ...(typeof verified === "boolean" ? { emailVerified: verified } : {}),
  };
}
