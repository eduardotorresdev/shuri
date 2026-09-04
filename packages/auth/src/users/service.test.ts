import type { CollectionStore, RecordInput } from "@shuri/store";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthStore, createClock } from "../test-support.js";
import { createUserService, normalizeEmail, type UserService } from "./service.js";

let collection: CollectionStore<RecordInput>;
let users: UserService;
const clock = createClock();

beforeEach(() => {
  collection = createAuthStore().collection("users") as CollectionStore<RecordInput>;
  users = createUserService(collection, clock);
});

describe("normalizeEmail", () => {
  it("trims and lowercases, so one address is one account", () => {
    expect(normalizeEmail(" Ada@Example.COM ")).toBe("ada@example.com");
  });
});

describe("createUserService", () => {
  it("creates a user with a normalized email and the current time", async () => {
    const user = await users.create({ email: " Ada@Example.com ", name: "Ada" });
    expect(user).toMatchObject({
      email: "ada@example.com",
      name: "Ada",
      emailVerified: false,
      createdAt: clock(),
    });
  });

  it("stores no passwordHash for an OIDC-only user", async () => {
    const user = await users.create({ email: "a@b.com" });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("finds a user by email regardless of case", async () => {
    await users.create({ email: "ada@example.com" });
    expect(await users.findByEmail("ADA@example.com")).toMatchObject({
      email: "ada@example.com",
    });
  });

  it("is undefined for an unknown email", async () => {
    expect(await users.findByEmail("nobody@example.com")).toBeUndefined();
  });

  it("picks the oldest row when the store somehow holds two of the same email", async () => {
    // A real adapter carries a unique index; this asserts login stays deterministic if one doesn't.
    const first = await collection.insert({ email: "a@b.com", createdAt: 1 });
    await collection.insert({ email: "a@b.com", createdAt: 2 });
    expect((await users.findByEmail("a@b.com"))?.id).toBe(first.id);
  });

  it("finds and updates by id", async () => {
    const user = await users.create({ email: "a@b.com" });
    await users.update(user.id, { name: "Ada" });
    expect(await users.findById(user.id)).toMatchObject({ name: "Ada" });
  });
});
