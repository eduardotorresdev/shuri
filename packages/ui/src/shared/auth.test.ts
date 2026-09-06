import { describe, expect, it } from "vitest";
import { createAdminAuthClient, SIGN_IN_REFUSED, signInErrorMessage } from "./auth.js";
import { AdminRequestError } from "./errors.js";
import type { AdminAuth } from "./schema.js";

const auth: AdminAuth = {
  basePath: "/auth",
  signIn: "/auth/login",
  signOut: "/auth/logout",
  providers: ["google"],
};

/**
 * Records every call and answers with whatever the test queued, so no server is involved.
 * @param responses - The responses to answer with, in order.
 * @returns The recorded calls and the `fetch` to hand the client.
 */
function stubFetch(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return responses.shift() ?? new Response(null, { status: 204 });
  };
  return { calls, fetch };
}

describe("createAdminAuthClient", () => {
  it("posts credentials to the auth base path the schema advertised", async () => {
    const { calls, fetch } = stubFetch([new Response(null, { status: 200 })]);

    await createAdminAuthClient(auth, { fetch }).signIn({
      email: "ada@example.com",
      password: "hunter2",
    });

    expect(calls[0]?.url).toBe("/auth/login");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"email":"ada@example.com","password":"hunter2"}');
  });

  it("posts wherever the schema says, so it speaks to any auth implementation", async () => {
    const { calls, fetch } = stubFetch([new Response(null, { status: 200 })]);

    await createAdminAuthClient(
      { ...auth, signIn: "/api/auth/sign-in/email" },
      { fetch },
    ).signIn({ email: "a@b.com", password: "x" });

    expect(calls[0]?.url).toBe("/api/auth/sign-in/email");
  });

  it("raises the server's message on a rejected sign-in", async () => {
    const { fetch } = stubFetch([
      new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ]);

    const attempt = createAdminAuthClient(auth, { fetch }).signIn({
      email: "a@b.com",
      password: "wrong",
    });

    await expect(attempt).rejects.toBeInstanceOf(AdminRequestError);
    await expect(attempt).rejects.toThrow("Invalid credentials");
  });

  it("still names the status when the body isn't the JSON we expect", async () => {
    const { fetch } = stubFetch([new Response("<html>502</html>", { status: 502 })]);

    await expect(
      createAdminAuthClient(auth, { fetch }).signIn({ email: "a@b.com", password: "x" }),
    ).rejects.toThrow("Request failed (502)");
  });

  it("signs out with a POST, which a prefetch or an <img> cannot trigger", async () => {
    const { calls, fetch } = stubFetch([new Response(null, { status: 204 })]);

    await createAdminAuthClient(auth, { fetch }).signOut();

    expect(calls[0]?.url).toBe("/auth/logout");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("sends no token anywhere, since the session lives in an HttpOnly cookie", async () => {
    const { calls, fetch } = stubFetch([new Response(null, { status: 204 })]);

    await createAdminAuthClient(auth, { fetch }).signOut();

    expect(calls[0]?.init?.headers).toBeUndefined();
  });

  it("builds an OIDC start URL that comes back to the admin", () => {
    const url = createAdminAuthClient(auth).oidcUrl("google", "/admin");

    expect(url).toBe("/auth/oidc/google?redirectTo=%2Fadmin");
  });

  it("escapes a provider id and a return path rather than splicing them in", () => {
    const url = createAdminAuthClient(auth).oidcUrl("a/b", "/admin?x=1&y=2");

    expect(url).toBe("/auth/oidc/a%2Fb?redirectTo=%2Fadmin%3Fx%3D1%26y%3D2");
  });

  it("prefixes the origin when the admin is embedded elsewhere", async () => {
    const { calls, fetch } = stubFetch([new Response(null, { status: 200 })]);

    await createAdminAuthClient(auth, {
      fetch,
      origin: "https://cms.example.com",
    }).signIn({
      email: "a@b.com",
      password: "x",
    });

    expect(calls[0]?.url).toBe("https://cms.example.com/auth/login");
  });
});

describe("signInErrorMessage", () => {
  it("says the same thing for a wrong password and an unknown email", () => {
    const refused = new AdminRequestError(401, "Invalid email or password");

    expect(signInErrorMessage(refused)).toBe(SIGN_IN_REFUSED);
  });

  it("hides the internal field path a shape check reports", () => {
    const tooShort = new AdminRequestError(
      400,
      'body.password: "password" must be at least 8 characters',
    );

    expect(signInErrorMessage(tooShort)).toBe(SIGN_IN_REFUSED);
    expect(signInErrorMessage(tooShort)).not.toContain("body.password");
  });

  it("lets a real failure keep its own message, so it isn't mistaken for a typo", () => {
    expect(signInErrorMessage(new AdminRequestError(500, "Internal error"))).toBe(
      "Internal error",
    );
    expect(signInErrorMessage(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
  });
});
