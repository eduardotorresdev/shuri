import { describe, expect, it } from "vitest";
import type { InferCollection } from "./infer.js";
import type { CollectionSchema } from "./types.js";

const users = {
  slug: "users",
  title: "Users",
  singular: "User",
  plural: "Users",
  internal: true,
  fields: [
    { type: "email", name: "email", required: true },
    { type: "text", name: "passwordHash", hidden: true },
  ],
} as const satisfies CollectionSchema;

describe("InferCollection", () => {
  it("keeps hidden fields in the inferred record shape", () => {
    // `hidden`/`internal` are HTTP-surface metadata, not record shape: the store is the complete
    // view, so a hidden field stays readable and writable programmatically.
    const record: InferCollection<typeof users> = {
      email: "a@b.com",
      passwordHash: "$pbkdf2-sha256$...",
    };
    expect(record.passwordHash).toBeDefined();
  });
});
