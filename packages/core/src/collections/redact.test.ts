import { describe, expect, it } from "vitest";
import type { CollectionSchema } from "./types.js";
import { hiddenFieldNames, redactRecord, redactRecords, servableCollections } from "./redact.js";

const accountsSchema: CollectionSchema = {
  slug: "accounts",
  title: "Accounts",
  singular: "Account",
  plural: "Accounts",
  fields: [
    { type: "email", name: "email", required: true },
    { type: "text", name: "passwordHash", hidden: true },
  ],
};

const sessionsSchema: CollectionSchema = {
  slug: "_sessions",
  title: "Sessions",
  singular: "Session",
  plural: "Sessions",
  internal: true,
  fields: [{ type: "text", name: "tokenHash", required: true }],
};

const secretsSchema = {
  slug: "secrets",
  title: "Secrets",
  category: { title: "Geral" },
  fields: [
    { type: "text", name: "name" },
    { type: "text", name: "apiKey", hidden: true },
  ],
} as const;

describe("hiddenFieldNames", () => {
  it("collects every field declared hidden", () => {
    expect([...hiddenFieldNames(accountsSchema)]).toEqual(["passwordHash"]);
  });

  it("is empty for a schema declaring none", () => {
    expect(hiddenFieldNames(sessionsSchema).size).toBe(0);
  });

  it("returns the same set for the same schema, memoized per schema object", () => {
    expect(hiddenFieldNames(accountsSchema)).toBe(hiddenFieldNames(accountsSchema));
  });
});

describe("redactRecord", () => {
  it("drops the hidden fields and keeps everything else", () => {
    const redacted = redactRecord(accountsSchema, {
      id: "1",
      email: "a@b.com",
      passwordHash: "secret",
    });
    expect(redacted).toEqual({ id: "1", email: "a@b.com" });
  });

  it("copies instead of mutating: an adapter may hand out the record it stores", () => {
    const stored = { id: "1", email: "a@b.com", passwordHash: "secret" };
    const redacted = redactRecord(accountsSchema, stored);

    expect(redacted).not.toBe(stored);
    expect(stored.passwordHash).toBe("secret");
  });

  it("returns the record untouched when the schema hides nothing", () => {
    const stored = { id: "1", tokenHash: "abc" };
    expect(redactRecord(sessionsSchema, stored)).toBe(stored);
  });

  it("redacts a global's hidden fields too", () => {
    expect(redactRecord(secretsSchema, { name: "Shuri", apiKey: "k" })).toEqual({
      name: "Shuri",
    });
  });
});

describe("redactRecords", () => {
  it("redacts every record, in order, without mutating any of them", () => {
    const stored = [
      { id: "1", email: "a@b.com", passwordHash: "one" },
      { id: "2", email: "c@d.com", passwordHash: "two" },
    ];

    expect(redactRecords(accountsSchema, stored)).toEqual([
      { id: "1", email: "a@b.com" },
      { id: "2", email: "c@d.com" },
    ]);
    expect(stored[0]?.passwordHash).toBe("one");
  });
});

describe("servableCollections", () => {
  it("drops the internal ones and keeps the rest in order", () => {
    expect(servableCollections([accountsSchema, sessionsSchema])).toEqual([accountsSchema]);
  });
});
