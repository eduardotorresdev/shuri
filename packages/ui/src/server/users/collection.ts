import type { CollectionSchema } from "@shuri/core";

/**
 * The account fields the Users screens render, as a collection schema — the same shape every other
 * list and form in the admin is generated from.
 *
 * Declared here rather than derived from the auth implementation's own table: what an operator
 * edits is the admin's contract (`NewAdminUser`), and an implementation's table carries columns
 * (`image`, `updatedAt`, a plugin's `banned`) that are not part of it. Labelled in the language
 * everything else an author reads in this admin is written in.
 */
export const adminUsersCollection = {
  slug: "users",
  title: "Usuários",
  singular: "Usuário",
  plural: "Usuários",
  fields: [
    { type: "email", name: "email", label: "E-mail", required: true },
    { type: "text", name: "name", label: "Nome" },
    { type: "boolean", name: "emailVerified", label: "E-mail verificado" },
  ],
} as const satisfies CollectionSchema;
