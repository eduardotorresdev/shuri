import { beforeEach, describe, expect, it } from "vitest";
import { createAuth, type AuthApi } from "../create.js";
import { createAuthStore, createTestHasher, readSetCookie } from "../test-support.js";

/**
 * Signup -> me -> logout -> login, driven entirely through `Request`/`Response` against a real store
 * on the in-memory adapter, carrying the cookie by hand the way a browser would.
 */
let auth: AuthApi;

beforeEach(() => {
  auth = createAuth({
    store: createAuthStore(),
    hasher: createTestHasher(),
    cookie: { secure: false },
  });
});

function post(path: string, body?: unknown, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `shuri_session=${cookie}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function get(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: cookie ? { cookie: `shuri_session=${cookie}` } : {},
  });
}

async function answer(request: Request): Promise<Response> {
  const response = await auth.handler(request);
  if (!response) throw new Error(`expected the auth handler to answer ${request.url}`);
  return response;
}

const credentials = { email: "ada@example.com", password: "correct-horse-battery" };

describe("the email + password flow", () => {
  it("signs up, reads the session back, signs out and signs in again", async () => {
    const signup = await answer(post("/auth/signup", credentials));
    expect(signup.status).toBe(201);
    expect(await signup.json()).toEqual({
      user: {
        id: expect.any(String),
        email: "ada@example.com",
        emailVerified: false,
        createdAt: expect.any(Number),
      },
    });

    const cookie = readSetCookie(signup);
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await answer(get("/auth/me", cookie));
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(
      "ada@example.com",
    );

    const logout = await answer(post("/auth/logout", undefined, cookie));
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

    expect((await answer(get("/auth/me", cookie))).status).toBe(401);

    const login = await answer(post("/auth/login", credentials));
    expect(login.status).toBe(200);
    expect((await answer(get("/auth/me", readSetCookie(login)))).status).toBe(200);
  });

  it("never puts the password hash on the wire", async () => {
    const signup = await answer(post("/auth/signup", credentials));
    expect(await signup.text()).not.toContain("pbkdf2");
  });

  it("accepts the session as a bearer token too", async () => {
    const cookie = readSetCookie(await answer(post("/auth/signup", credentials)));
    const response = await answer(
      new Request("http://localhost/auth/me", {
        headers: { authorization: `Bearer ${cookie}` },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("refuses a second signup with the same address", async () => {
    await answer(post("/auth/signup", credentials));
    expect((await answer(post("/auth/signup", credentials))).status).toBe(409);
  });

  it("answers 401 with no credential at all", async () => {
    expect((await answer(get("/auth/me"))).status).toBe(401);
  });

  it("answers 405 for the wrong method and 415 without a JSON content type", async () => {
    expect((await answer(get("/auth/signup"))).status).toBe(405);
    expect((await answer(post("/auth/me"))).status).toBe(405);

    const formPost = new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a@b.com&password=correct-horse",
    });
    expect((await answer(formPost)).status).toBe(415);
  });

  it("falls through for anything outside the base path", async () => {
    expect(await auth.handler(get("/collections/posts"))).toBeUndefined();
  });

  it("exposes the same flows programmatically", async () => {
    const issued = await auth.signUp(credentials);
    expect(await auth.getSession(get("/", issued.token))).toMatchObject({
      user: { email: "ada@example.com" },
    });

    await auth.signOut(issued.token);
    expect(await auth.getSession(get("/", issued.token))).toBeUndefined();
    await expect(auth.requireSession(get("/", issued.token))).rejects.toThrow(
      "Not authenticated",
    );
  });
});
