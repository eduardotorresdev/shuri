import { beforeEach, describe, expect, it } from "vitest";
import { createAuth, type AuthApi } from "../create.js";
import { createAuthStore, createTestHasher } from "../test-support.js";

/**
 * The one property the login route exists to hold: nothing about a failed sign-in tells the caller
 * whether the address is registered. The per-unit coverage (including the OIDC-only account and the
 * equal-cost dummy derivation) lives in `credentials/login.test.ts`; this asserts it over HTTP.
 */
let auth: AuthApi;

beforeEach(() => {
  auth = createAuth({
    store: createAuthStore(),
    hasher: createTestHasher(),
    cookie: { secure: false },
  });
});

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function answer(request: Request): Promise<Response> {
  const response = await auth.handler(request);
  if (!response) throw new Error(`expected the auth handler to answer ${request.url}`);
  return response;
}

const credentials = { email: "ada@example.com", password: "correct-horse-battery" };

describe("user enumeration", () => {
  it("makes an unknown email and a wrong password indistinguishable", async () => {
    await answer(post("/auth/signup", credentials));

    const unknown = await answer(
      post("/auth/login", {
        email: "nobody@example.com",
        password: credentials.password,
      }),
    );
    const wrong = await answer(
      post("/auth/login", { email: credentials.email, password: "wrong-password-here" }),
    );

    const [unknownBody, wrongBody] = await Promise.all([unknown.text(), wrong.text()]);

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknownBody).toBe(wrongBody);
    expect(JSON.parse(unknownBody)).toEqual({ error: "Invalid email or password" });
  });
});
