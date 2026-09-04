import type { CollectionStore, RecordInput } from "@shuri/store";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthStore, createClock } from "../test-support.js";
import { createUserService, type UserService } from "../users/service.js";
import {
  createSessionService,
  DEFAULT_RENEW_WITHIN_MS,
  DEFAULT_TTL_MS,
  type SessionService,
} from "./store.js";
import { hashSessionToken } from "./tokens.js";

const DAY = 24 * 60 * 60 * 1000;

let clock: ReturnType<typeof createClock>;
let sessionRecords: CollectionStore<RecordInput>;
let users: UserService;
let sessions: SessionService;
let userId: string;

async function setup(renewWithinMs = DEFAULT_RENEW_WITHIN_MS): Promise<void> {
  const store = createAuthStore();
  clock = createClock();
  sessionRecords = store.collection("_sessions") as CollectionStore<RecordInput>;
  users = createUserService(
    store.collection("users") as CollectionStore<RecordInput>,
    clock,
  );
  sessions = createSessionService({
    sessions: sessionRecords,
    users,
    now: clock,
    ttlMs: DEFAULT_TTL_MS,
    renewWithinMs,
  });
  userId = (await users.create({ email: "a@b.com" })).id;
}

beforeEach(() => setup());

describe("create", () => {
  it("issues a token and stores only its digest", async () => {
    const issued = await sessions.create(userId);
    const [stored] = await sessionRecords.findMany();

    expect(stored["tokenHash"]).toBe(await hashSessionToken(issued.token));
    expect(JSON.stringify(stored)).not.toContain(issued.token);
  });

  it("expires ttlMs from now and records the client metadata", async () => {
    const issued = await sessions.create(userId, { userAgent: "curl", ip: "1.2.3.4" });
    expect(issued.session.expiresAt).toBe(clock() + DEFAULT_TTL_MS);
    expect(await sessionRecords.findOne(issued.session.id)).toMatchObject({
      userAgent: "curl",
      ip: "1.2.3.4",
    });
  });

  it("returns the public user, never the password hash", async () => {
    await users.update(userId, { passwordHash: "$pbkdf2$secret" });
    const issued = await sessions.create(userId);
    expect(issued.user).not.toHaveProperty("passwordHash");
    expect(issued.user.email).toBe("a@b.com");
  });
});

describe("resolve", () => {
  it("resolves a live token to its session and user", async () => {
    const issued = await sessions.create(userId);
    const session = await sessions.resolve(issued.token);
    expect(session).toMatchObject({ id: issued.session.id, renewed: false });
    expect(session?.user.id).toBe(userId);
  });

  it("is undefined for a token nobody issued", async () => {
    expect(await sessions.resolve("not-a-token")).toBeUndefined();
  });

  it("rejects an expired session and deletes the dead row on the way through", async () => {
    const issued = await sessions.create(userId);
    clock.advance(DEFAULT_TTL_MS + 1);

    expect(await sessions.resolve(issued.token)).toBeUndefined();
    expect(await sessionRecords.findMany()).toEqual([]);
  });

  it("rejects a session whose user is gone, and deletes it: nobody could revoke it", async () => {
    const issued = await sessions.create(userId);
    await sessionRecords.update(issued.session.id, { user: "deleted-user" });

    expect(await sessions.resolve(issued.token)).toBeUndefined();
    expect(await sessionRecords.findMany()).toEqual([]);
  });

  it("slides the expiry forward once the session enters the renewal window", async () => {
    const issued = await sessions.create(userId);
    clock.advance(DEFAULT_TTL_MS - DEFAULT_RENEW_WITHIN_MS + DAY);

    const session = await sessions.resolve(issued.token);

    expect(session?.renewed).toBe(true);
    expect(session?.expiresAt).toBe(clock() + DEFAULT_TTL_MS);
    expect(await sessionRecords.findOne(issued.session.id)).toMatchObject({
      expiresAt: clock() + DEFAULT_TTL_MS,
    });
  });

  it("leaves a fresh session alone, so a read isn't a write on every request", async () => {
    const issued = await sessions.create(userId);
    clock.advance(DAY);

    const session = await sessions.resolve(issued.token);
    expect(session?.renewed).toBe(false);
    expect(session?.expiresAt).toBe(issued.session.expiresAt);
  });

  it("never renews when renewWithinMs is 0", async () => {
    await setup(0);
    const issued = await sessions.create(userId);
    clock.advance(DEFAULT_TTL_MS - 1000);

    expect((await sessions.resolve(issued.token))?.renewed).toBe(false);
  });
});

describe("revoke", () => {
  it("deletes the session, so the token stops working immediately", async () => {
    const issued = await sessions.create(userId);
    await sessions.revoke(issued.token);

    expect(await sessions.resolve(issued.token)).toBeUndefined();
    expect(await sessionRecords.findMany()).toEqual([]);
  });

  it("is a no-op for a token nobody issued", async () => {
    await expect(sessions.revoke("not-a-token")).resolves.toBeUndefined();
  });
});

describe("pruneExpired", () => {
  it("deletes every expired row and reports how many, for a host's cron", async () => {
    await sessions.create(userId);
    await sessions.create(userId);
    clock.advance(DEFAULT_TTL_MS + 1);
    const live = await sessions.create(userId);

    expect(await sessions.pruneExpired()).toBe(2);
    expect((await sessionRecords.findMany()).map((row) => row.id)).toEqual([
      live.session.id,
    ]);
  });
});
