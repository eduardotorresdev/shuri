import { getSchema } from "better-auth/db";
import type { BetterAuthOptions } from "better-auth";
import type { CollectionSchema, Field } from "@shuri/core";

/** Fields better-auth never wants read back over HTTP, whatever table they turn up in. */
const SECRET_FIELDS: ReadonlySet<string> = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "value",
  // `@better-auth/api-key`: the key's hash.
  "key",
]);

/**
 * Fields better-auth looks a row up by on a hot path — a session by its token on every request, a
 * user by email on every sign-in — declared `index: true` so the store answers them in O(1) rather
 * than scanning the table.
 */
const INDEXED_FIELDS: ReadonlySet<string> = new Set([
  "token",
  "email",
  "userId",
  "identifier",
  // `@better-auth/api-key`: a key by its hash on every request, a user's keys by owner.
  "key",
  "referenceId",
]);

/** One entry of better-auth's own schema description, narrowed to what this file reads. */
interface BetterAuthField {
  type: unknown;
  required?: boolean;
  references?: { model: string } | undefined;
}

/**
 * Maps one better-auth field onto a `@shuri/core` `Field`.
 *
 * `date`, `string[]` and `number[]` all land on `text`: `@shuri/core` has none of those types, and
 * the adapter is configured with `supportsDates`/`supportsArrays`/`supportsJSON` off, so better-auth
 * hands them over already serialized. An ISO-8601 date still orders correctly as a string, which is
 * what the session-expiry queries need.
 *
 * A field with `references` becomes a `relation`, which is both the truthful description and what
 * lets a future admin screen resolve it — `defineCollections` checks the target slug exists, and it
 * does, since these collections are emitted together.
 * @param name - The field's name.
 * @param field - better-auth's description of it.
 * @returns The Shuri field.
 */
function toField(name: string, field: BetterAuthField): Field {
  const required = field.required === true;
  const hidden = SECRET_FIELDS.has(name);
  const index = INDEXED_FIELDS.has(name);
  const base = {
    name,
    ...(required ? { required } : {}),
    ...(hidden ? { hidden } : {}),
    ...(index ? { index } : {}),
  };

  if (field.references) {
    return { ...base, type: "relation", collection: field.references.model };
  }
  if (field.type === "boolean") return { ...base, type: "boolean" };
  if (field.type === "number") return { ...base, type: "number", kind: "float" };
  return { ...base, type: "text" };
}

/**
 * Derives the Shuri collections better-auth needs from better-auth's own schema description.
 *
 * Derived rather than hand-written, because the set of tables is not fixed: enabling the `admin`
 * plugin adds `role` and `banned` to `user`, `organization` adds three whole tables, and a
 * hand-maintained copy would be wrong the moment a host changed its plugins. Passing the same
 * options here that go to `betterAuth()` keeps the two in step by construction.
 *
 * Every collection is `internal: true`: these tables are better-auth's to maintain, and serving
 * them over REST would expose an open directory of registered emails alongside session and account
 * rows. Secret-bearing columns are `hidden` on top of that, so nothing leaks even if a host opts one
 * collection back in.
 * @param options - The very same options passed to `betterAuth()`.
 * @returns One collection per better-auth table, in better-auth's own order.
 */
export function betterAuthCollections(
  options: BetterAuthOptions = {},
): readonly CollectionSchema[] {
  const schema = getSchema(options);

  return Object.entries(schema).map(([slug, table]) => ({
    slug,
    title: slug,
    singular: slug,
    plural: slug,
    internal: true,
    fields: Object.entries(table.fields).map(([name, field]) =>
      toField(name, field as BetterAuthField),
    ),
  }));
}
