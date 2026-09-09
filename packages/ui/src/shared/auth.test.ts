import { describe, expect, it } from "vitest";
import { createAdminAuthClient, SIGN_IN_REFUSED, signInErrorMessage } from "./auth.js";
import { AdminRequestError } from "./errors.js";
import type { AdminAuth } from "./schema.js";

const auth: AdminAuth = {
  basePath: "/api/auth",
  signIn: "/api/auth/sign-in/email",
  signOut: "/api/auth/sign-out",
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

    expect(calls[0]?.url).toBe("/api/auth/sign-in/email");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"email":"ada@example.com","password":"hunter2"}');
  });

  it("posts wherever the schema says, so it speaks to any auth implementation", async () => {
    const { calls, fetch } = stubFetch([new Response(null, { status: 200 })]);

    await createAdminAuthClient({ ...auth, signIn: "/auth/login" }, { fetch }).signIn({
      email: "a@b.com",
      password: "x",
    });

    expect(calls[0]?.url).toBe("/auth/login");
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

    expect(calls[0]?.url).toBe("/api/auth/sign-out");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("sends no token anywhere, since the session lives in an HttpOnly cookie", async () => {
    const { calls, fetch } = stubFetch([new Response(null, { status: 204 })]);

    await createAdminAuthClient(auth, { fetch }).signOut();

    expect(calls[0]?.init?.headers).toBeUndefined();
  });

  it("starts a social sign-in and hands back the URL to navigate to", async () => {
    const { calls, fetch } = stubFetch([
      new Response(
        JSON.stringify({ url: "https://accounts.google.com/o/oauth2?x", redirect: true }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ]);

    const url = await createAdminAuthClient(auth, { fetch }).signInSocial(
      "google",
      "/admin",
    );

    expect(url).toBe("https://accounts.google.com/o/oauth2?x");
    expect(calls[0]?.url).toBe("/api/auth/sign-in/social");
    expect(calls[0]?.init?.body).toBe('{"provider":"google","callbackURL":"/admin"}');
  });

  it("refuses a social sign-in that answered without a URL", async () => {
    const { fetch } = stubFetch([
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);

    await expect(
      createAdminAuthClient(auth, { fetch }).signInSocial("google", "/admin"),
    ).rejects.toThrow("Sign-in returned no URL");
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

    expect(calls[0]?.url).toBe("https://cms.example.com/api/auth/sign-in/email");
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
      'password: "password" must be at least 8 characters',
    );

    expect(signInErrorMessage(tooShort)).toBe(SIGN_IN_REFUSED);
    expect(signInErrorMessage(tooShort)).not.toContain("password");
  });

  it("lets a real failure keep its own message, so it isn't mistaken for a typo", () => {
    expect(signInErrorMessage(new AdminRequestError(500, "Internal error"))).toBe(
      "Internal error",
    );
    expect(signInErrorMessage(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
  });
});
