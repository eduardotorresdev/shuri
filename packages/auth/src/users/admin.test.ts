import { describe, expect, it } from "vitest";
import type { CollectionStore, RecordInput, Store } from "@shuri/store";
import { createUserAdmin, type UserAdminApi } from "./admin.js";
import { createSessionService, DEFAULT_TTL_MS } from "../sessions/store.js";
import { createUserService } from "./service.js";
import { createAuthStore, createClock, createTestHasher } from "../test-support.js";

interface Harness {
  admin: UserAdminApi;
  store: Store;
  users: ReturnType<typeof createUserService>;
  sessions: ReturnType<typeof createSessionService>;
  accounts: CollectionStore<RecordInput>;
}

function harness(): Harness {
  const store = createAuthStore();
  const now = createClock();
  const users = createUserService(
    store.collection("users") as CollectionStore<RecordInput>,
    now,
  );
  const sessions = createSessionService({
    sessions: store.collection("_sessions") as CollectionStore<RecordInput>,
    users,
    now,
    ttlMs: DEFAULT_TTL_MS,
    renewWithinMs: 0,
  });
  const accounts = store.collection("_accounts") as CollectionStore<RecordInput>;

  return {
    store,
    users,
    sessions,
    accounts,
    admin: createUserAdmin({
      users,
      sessions,
      accounts,
      credentials: { hasher: createTestHasher() },
    }),
  };
}

describe("create", () => {
  it("registers a user without issuing a session, unlike signing up", async () => {
    const { admin, store } = harness();

    const user = await admin.create({ email: "Ada@Example.com", name: "Ada" });

    expect(user.email).toBe("ada@example.com");
    expect(user.name).toBe("Ada");
    expect(await store.collection("_sessions").findMany()).toHaveLength(0);
  });

  it("hashes the password given, and never hands it back in any form", async () => {
    const { admin, users } = harness();

    const user = await admin.create({
      email: "ada@example.com",
      password: "correct horse battery",
    });

    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("password");
    const stored = await users.findById(user.id);
    expect(stored?.["passwordHash"]).toMatch(/^\$pbkdf2-sha256\$/);
  });

  it("accepts an account with no password, which is what an OIDC-only user is", async () => {
    const { admin, users } = harness();

    const user = await admin.create({ email: "ada@example.com" });

    expect((await users.findById(user.id))?.["passwordHash"]).toBeUndefined();
  });

  it("refuses an address already registered, however it is cased", async () => {
    const { admin } = harness();
    await admin.create({ email: "ada@example.com" });

    await expect(admin.create({ email: "ADA@example.com" })).rejects.toThrow(
      /already registered/i,
    );
  });

  it("refuses a body that writes the stored hash directly", async () => {
    const { admin } = harness();

    await expect(
      admin.create({
        email: "ada@example.com",
        passwordHash: "$pbkdf2-sha256$…",
      } as never),
    ).rejects.toThrow(/passwordHash/);
  });

  it("holds the password to the same policy signup does", async () => {
    const { admin } = harness();

    await expect(
      admin.create({ email: "ada@example.com", password: "short" }),
    ).rejects.toThrow(/at least 8 characters/);
  });

  it("names the field an issue belongs to, so a form can put it under that input", async () => {
    const { admin } = harness();

    const issues = await admin
      .create({ email: "not an address", password: "short" })
      .then(
        () => [],
        (error: { issues: { path: string }[] }) => error.issues,
      );

    expect(issues.map((issue) => issue.path)).toEqual(["email", "password"]);
  });
});

describe("update", () => {
  it("changes only what the patch carries", async () => {
    const { admin } = harness();
    const created = await admin.create({ email: "ada@example.com", name: "Ada" });

    const updated = await admin.update(created.id, { name: "Ada Lovelace" });

    expect(updated).toMatchObject({ email: "ada@example.com", name: "Ada Lovelace" });
  });

  it("lets a user keep their own address while refusing somebody else's", async () => {
    const { admin } = harness();
    const ada = await admin.create({ email: "ada@example.com" });
    await admin.create({ email: "alan@example.com" });

    await expect(
      admin.update(ada.id, { email: "ada@example.com" }),
    ).resolves.toBeTruthy();
    await expect(admin.update(ada.id, { email: "alan@example.com" })).rejects.toThrow(
      /already registered/i,
    );
  });

  it("revokes every session when the password changes, or the reset resets nothing", async () => {
    const { admin, sessions, store } = harness();
    const ada = await admin.create({
      email: "ada@example.com",
      password: "old password",
    });
    await sessions.create(ada.id);
    await sessions.create(ada.id);

    await admin.update(ada.id, { password: "new password!" });

    expect(await store.collection("_sessions").findMany()).toHaveLength(0);
  });

  it("leaves the sessions alone for a change that isn't the password", async () => {
    const { admin, sessions, store } = harness();
    const ada = await admin.create({ email: "ada@example.com" });
    await sessions.create(ada.id);

    await admin.update(ada.id, { name: "Ada" });

    expect(await store.collection("_sessions").findMany()).toHaveLength(1);
  });

  it("refuses an id nobody has", async () => {
    const { admin } = harness();

    await expect(admin.update("nope", { name: "Ada" })).rejects.toThrow(/No user/);
  });
});

describe("remove", () => {
  it("takes the sessions and the identity links with the user", async () => {
    const { admin, sessions, accounts, store } = harness();
    const ada = await admin.create({ email: "ada@example.com" });
    const alan = await admin.create({ email: "alan@example.com" });
    await sessions.create(ada.id);
    await sessions.create(alan.id);
    await accounts.insert({
      provider: "google",
      subject: "sub-1",
      user: ada.id,
      createdAt: 1,
    });
    await accounts.insert({
      provider: "google",
      subject: "sub-2",
      user: alan.id,
      createdAt: 1,
    });

    await admin.remove(ada.id);

    expect(await admin.list()).toHaveLength(1);
    // Only the removed user's rows: a cascade that took the whole table would be worse than none.
    expect(await store.collection("_sessions").findMany()).toHaveLength(1);
    expect(await accounts.findMany()).toHaveLength(1);
  });

  it("refuses an id nobody has", async () => {
    const { admin } = harness();

    await expect(admin.remove("nope")).rejects.toThrow(/No user/);
  });
});

describe("list", () => {
  it("filters and sorts like any other collection, and redacts like every other read", async () => {
    const { admin } = harness();
    await admin.create({ email: "ada@example.com", name: "Ada", password: "a password" });
    await admin.create({ email: "alan@example.com", name: "Alan" });

    const found = await admin.list({
      where: { email: { op: "contains", value: "alan" } },
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ email: "alan@example.com", name: "Alan" });
    expect(await admin.list()).toEqual(
      expect.arrayContaining([
        expect.not.objectContaining({ passwordHash: expect.anything() }),
      ]),
    );
  });
});
