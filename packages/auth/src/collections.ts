import type { CollectionSchema } from "@shuri/core";

/**
 * The user record. `internal: true` by default because, until per-collection rules land, a served
 * `users` collection is an open directory of every registered email — `hidden` removes a field from
 * a response, it doesn't hide the rows. A host that wants it served opts out in one line:
 * `create({ collections: [{ ...usersCollection, internal: false }, ...] })`.
 *
 * `passwordHash` is `hidden` (never leaves, never writable over HTTP) and deliberately **not**
 * `required`: a field that is both would make the collection impossible to create through REST, and
 * an OIDC-only user legitimately has no password at all.
 *
 * `createdAt` is epoch milliseconds rather than an ISO string because the memory adapter compares
 * strings with `localeCompare` — locale-dependent collation — while numbers compare with `a - b`,
 * which is exact and portable.
 */
export const usersCollection = {
  slug: "users",
  title: "Users",
  singular: "User",
  plural: "Users",
  internal: true,
  fields: [
    { type: "email", name: "email", required: true },
    { type: "text", name: "name" },
    { type: "text", name: "passwordHash", hidden: true },
    { type: "boolean", name: "emailVerified" },
    {
      type: "number",
      name: "createdAt",
      kind: "integer",
      sign: "positive",
      required: true,
    },
  ],
} as const satisfies CollectionSchema;

/**
 * One row per live session. Only the SHA-256 of the token is stored: a database dump can't be
 * replayed as a set of valid sessions. No salt and no stretching on that digest — 256 uniform bits
 * have no dictionary to attack, and stretching would add latency to *every* authenticated request.
 */
export const sessionsCollection = {
  slug: "_sessions",
  title: "Sessions",
  singular: "Session",
  plural: "Sessions",
  internal: true,
  fields: [
    { type: "text", name: "tokenHash", required: true, minLength: 43, maxLength: 43 },
    { type: "relation", name: "user", collection: "users", required: true },
    {
      type: "number",
      name: "createdAt",
      kind: "integer",
      sign: "positive",
      required: true,
    },
    {
      type: "number",
      name: "expiresAt",
      kind: "integer",
      sign: "positive",
      required: true,
    },
    { type: "text", name: "userAgent" },
    { type: "text", name: "ip" },
  ],
} as const satisfies CollectionSchema;

/** Links an external identity (`provider` + the `sub` claim) to a local user. */
export const accountsCollection = {
  slug: "_accounts",
  title: "Accounts",
  singular: "Account",
  plural: "Accounts",
  internal: true,
  fields: [
    { type: "text", name: "provider", required: true },
    { type: "text", name: "subject", required: true },
    { type: "relation", name: "user", collection: "users", required: true },
    {
      type: "number",
      name: "createdAt",
      kind: "integer",
      sign: "positive",
      required: true,
    },
  ],
} as const satisfies CollectionSchema;

/**
 * The three collections auth needs, in declaration order — `users` first, since the other two carry
 * a `relation` to it.
 *
 * A plain constant, not a factory: `InferCollection` reads the literal slugs off it, which is what
 * types `app.auth` and keeps `@shuri/sdk`'s merge a one-liner. Renaming these slugs per host would
 * cost exactly that.
 */
export const authCollections = [
  usersCollection,
  sessionsCollection,
  accountsCollection,
] as const;

/** The slugs `@shuri/auth` claims, which a consumer's own collections must not reuse. */
export const AUTH_SLUGS: readonly string[] = authCollections.map(
  (collection) => collection.slug,
);
