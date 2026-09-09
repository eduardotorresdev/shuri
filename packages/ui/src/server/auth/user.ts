import type { AdminUser } from "../../shared/schema.js";
import type { AdminSessionUser } from "./types.js";

/**
 * Narrows an `AdminSessionUser` to the three fields the admin's header shows.
 *
 * A whitelist, not a copy: `AdminSessionUser` carries an index signature, so every extra field a host
 * declares on `users` — an internal note, a billing id — would otherwise ride along into a document
 * served to anonymous callers.
 * @param user - The user behind the session.
 * @returns The admin's view of `user`.
 */
export function toAdminUser(user: AdminSessionUser): AdminUser {
  return {
    id: user.id,
    email: user.email,
    ...(typeof user.name === "string" ? { name: user.name } : {}),
  };
}
