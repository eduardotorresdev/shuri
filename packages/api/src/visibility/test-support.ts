import type { CollectionSchema, GlobalSchema } from "@shuri/core";

/** Collection declaring a hidden field, shared by this folder's unit tests. */
export const accountsSchema: CollectionSchema = {
  slug: "accounts",
  title: "Accounts",
  singular: "Account",
  plural: "Accounts",
  fields: [
    { type: "email", name: "email", required: true },
    { type: "text", name: "passwordHash", hidden: true },
  ],
};

/** Collection kept off HTTP entirely, shared by this folder's unit tests. */
export const sessionsSchema: CollectionSchema = {
  slug: "_sessions",
  title: "Sessions",
  singular: "Session",
  plural: "Sessions",
  internal: true,
  fields: [{ type: "text", name: "tokenHash", required: true }],
};

/** Global declaring a hidden field, shared by this folder's unit tests. */
export const secretsSchema: GlobalSchema = {
  slug: "secrets",
  title: "Secrets",
  category: { title: "Geral" },
  fields: [
    { type: "text", name: "name" },
    { type: "text", name: "apiKey", hidden: true },
  ],
};
