import type { Query, RecordId } from "@shuri/store";

/** An account as the Users screens list and edit it. Never carries a credential. */
export interface AdminUserRecord {
  id: RecordId;
  email: string;
  name?: string;
  emailVerified?: boolean;
  [field: string]: unknown;
}

/**
 * What the create form sends. A password is optional: an account without one signs in through a
 * social provider, or waits for an operator to set one.
 */
export interface NewAdminUser {
  email: string;
  password?: string;
  name?: string;
  emailVerified?: boolean;
}

/** What the edit form sends: any subset of the same fields, `password` included. */
export type AdminUserPatch = Partial<NewAdminUser>;

/**
 * Creating, reading, changing and removing users, as an operator does it rather than as a visitor
 * does: no session is issued, no password is required, and the caller is somebody else.
 *
 * The admin's port onto whatever auth implementation the host runs. `@shuri/better-auth` ships one
 * on its session source; a host may put its own behind the screens through `AdminAuthOptions.users`.
 */
export interface UserAdminApi {
  /** A page of users, filtered and sorted like any other collection. */
  list(query?: Query): Promise<AdminUserRecord[]>;
  get(id: RecordId): Promise<AdminUserRecord>;
  create(input: NewAdminUser): Promise<AdminUserRecord>;
  /** Setting `password` is expected to revoke the user's sessions: a reset that leaves the old cookies working resets nothing. */
  update(id: RecordId, patch: AdminUserPatch): Promise<AdminUserRecord>;
  /** Deletes the user, their sessions and their identity links. */
  remove(id: RecordId): Promise<void>;
}
