import type { RecordInput, StoreRecord } from "@shuri/store";
import { usersCollection } from "../collections.js";
import type { AuthUser } from "../types.js";

/**
 * Projects a stored user onto what this package hands out.
 *
 * A **whitelist derived from the schema**, not a blacklist: it walks the declared fields, keeps
 * every non-`hidden` name plus `id`, and drops everything else. So an adapter returning an extra
 * column leaks nothing, and a field marked `hidden` tomorrow disappears from every response for
 * free.
 * @param record - The stored user record.
 * @param [schema] - The users schema to whitelist from; pass a host-extended one to expose its fields.
 * @returns The public user.
 */
export function toPublicUser(
  record: StoreRecord<RecordInput>,
  schema: { fields: readonly { name: string; hidden?: boolean }[] } = usersCollection,
): AuthUser {
  const user: RecordInput = { id: record.id };
  for (const field of schema.fields) {
    if (field.hidden) continue;
    if (field.name in record) user[field.name] = record[field.name];
  }
  return user as unknown as AuthUser;
}
