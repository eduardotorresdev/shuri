import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TTL_MS } from "../sessions/store.js";
import { createAuth, type AuthApi } from "../create.js";
import {
  createAuthStore,
  createClock,
  createTestHasher,
  readSetCookie,
} from "../test-support.js";

const DAY = 24 * 60 * 60 * 1000;

let clock: ReturnType<typeof createClock>;
let auth: AuthApi;

function build(renewWithinMs: number): AuthApi {
  clock = createClock();
  return createAuth({
    store: createAuthStore(),
    hasher: createTestHasher(),
    cookie: { secure: false },
    now: clock,
    session: { renewWithinMs },
  });
}

beforeEach(() => {
  auth = build(15 * DAY);
});

function get(cookie: string): Request {
  return new Request("http://localhost/auth/me", {
    headers: { cookie: `shuri_session=${cookie}` },
  });
}

async function signUp(api: AuthApi = auth): Promise<string> {
  const response = await api.handler(
    new Request("http://localhost/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "correct-horse-battery" }),
    }),
  );
  return readSetCookie(response as Response) as string;
}

describe("session expiry", () => {
  it("rejects an expired session and deletes its row on the way through", async () => {
    const token = await signUp();
    clock.advance(DEFAULT_TTL_MS + 1);

    const response = (await auth.handler(get(token))) as Response;
    expect(response.status).toBe(401);
    // Deleted lazily on read: a second attempt still fails, and no sweeper ever ran.
    expect(await auth.getSession(get(token))).toBeUndefined();
    expect(await auth.pruneExpiredSessions()).toBe(0);
  });

  it("re-emits the cookie once the session enters the renewal window", async () => {
    const token = await signUp();

    const fresh = (await auth.handler(get(token))) as Response;
    expect(fresh.headers.get("set-cookie")).toBeNull();

    clock.advance(DEFAULT_TTL_MS - 15 * DAY + DAY);
    const renewed = (await auth.handler(get(token))) as Response;

    expect(renewed.status).toBe(200);
    expect(renewed.headers.get("set-cookie")).toContain("shuri_session=");
    expect(readSetCookie(renewed)).toBe(token);
  });

  it("never renews when the host turned sliding renewal off", async () => {
    auth = build(0);
    const token = await signUp();
    clock.advance(DEFAULT_TTL_MS - 1000);

    const response = (await auth.handler(get(token))) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("prunes expired rows on demand, for a host's cron", async () => {
    const token = await signUp();
    clock.advance(DEFAULT_TTL_MS + 1);

    expect(await auth.pruneExpiredSessions()).toBe(1);
    expect(await auth.getSession(get(token))).toBeUndefined();
  });
});
