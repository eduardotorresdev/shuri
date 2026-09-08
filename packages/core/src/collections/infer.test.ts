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

const tagged = {
  slug: "tagged",
  title: "Tagged",
  singular: "Tagged",
  plural: "Tagged",
  fields: [
    {
      type: "select",
      name: "tag",
      options: [{ label: "A", value: "a" }],
    },
    {
      type: "select",
      name: "tags",
      multiple: true,
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
    },
  ],
} as const satisfies CollectionSchema;

describe("InferCollection", () => {
  it("infers a multiple select as a list of its options", () => {
    const record: InferCollection<typeof tagged> = { tag: "a", tags: ["a", "b"] };
    // @ts-expect-error a multiple select is a list, not one option
    const wrong: InferCollection<typeof tagged> = { tags: "a" };
    expect(record.tags).toHaveLength(2);
    expect(wrong).toBeDefined();
  });

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
