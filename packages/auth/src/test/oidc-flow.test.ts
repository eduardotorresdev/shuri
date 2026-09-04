import { beforeEach, describe, expect, it } from "vitest";
import { TRANSACTION_COOKIE_NAME } from "../oidc/transaction.js";
import {
  CLIENT_ID,
  createOidcHarness,
  ISSUER,
  TEST_REDIRECT_URI,
  type OidcHarness,
} from "../oidc/test-support.js";
import { readSetCookie } from "../test-support.js";

/** The happy path of Authorization Code + PKCE, start to callback, against a stubbed `fetch`. */
let harness: OidcHarness;

beforeEach(() => {
  harness = createOidcHarness();
});

describe("the OIDC start route", () => {
  it("redirects to the provider with state, nonce and a PKCE challenge", async () => {
    const response = await harness.answer(new Request("http://localhost/auth/oidc/acme"));
    expect(response.status).toBe(302);

    const location = new URL(response.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: TEST_REDIRECT_URI,
      scope: "openid email profile",
      code_challenge_method: "S256",
    });
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("scopes the transaction cookie to the OIDC subtree and keeps it short-lived", async () => {
    const response = await harness.answer(new Request("http://localhost/auth/oidc/acme"));
    const cookie = response.headers.get("set-cookie") as string;

    expect(cookie).toContain(`${TRANSACTION_COOKIE_NAME}=`);
    expect(cookie).toContain("Path=/auth/oidc");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("never puts the PKCE verifier where the provider could see it", async () => {
    const response = await harness.answer(new Request("http://localhost/auth/oidc/acme"));
    expect(response.headers.get("location")).not.toContain("code_verifier");
  });

  it("404s an unconfigured provider", async () => {
    expect(
      (await harness.answer(new Request("http://localhost/auth/oidc/nope"))).status,
    ).toBe(404);
  });

  it("502s when discovery fails", async () => {
    harness.stub.setDiscovery(undefined);
    expect(
      (await harness.answer(new Request("http://localhost/auth/oidc/acme"))).status,
    ).toBe(502);
  });
});

describe("the OIDC callback route", () => {
  it("signs the user in and clears the transaction cookie", async () => {
    const started = await harness.start();
    harness.withTokens();

    const response = await harness.answer(
      harness.callback(started, { code: "auth-code", state: started.state }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("shuri_session="))).toBe(true);
    expect(
      cookies.some(
        (cookie) =>
          cookie.startsWith(`${TRANSACTION_COOKIE_NAME}=`) &&
          cookie.includes("Max-Age=0"),
      ),
    ).toBe(true);

    const me = await harness.answer(
      new Request("http://localhost/auth/me", {
        headers: { cookie: `shuri_session=${readSetCookie(response) as string}` },
      }),
    );
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(
      "ada@example.com",
    );
  });

  it("redeems the code with PKCE and the registered redirect URI", async () => {
    const started = await harness.start();
    harness.withTokens();
    await harness.answer(
      harness.callback(started, { code: "auth-code", state: started.state }),
    );

    const exchange = harness.stub.calls.find((call) => call.url.endsWith("/token"));
    const body = new URLSearchParams(exchange?.body ?? "");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.get("redirect_uri")).toBe(TEST_REDIRECT_URI);
  });

  it("signs the same identity back into the same account on the next sign-in", async () => {
    const first = await harness.start();
    harness.withTokens();
    await harness.answer(harness.callback(first, { code: "c", state: first.state }));

    const second = await harness.start();
    harness.withTokens();
    const response = await harness.answer(
      harness.callback(second, { code: "c", state: second.state }),
    );

    const me = await harness.answer(
      new Request("http://localhost/auth/me", {
        headers: { cookie: `shuri_session=${readSetCookie(response) as string}` },
      }),
    );
    expect(me.status).toBe(200);
  });

  it("honors a safe redirectTo and ignores an attacker-chosen one", async () => {
    const safe = await harness.start("?redirectTo=%2Fdashboard");
    harness.withTokens();
    expect(
      (
        await harness.answer(harness.callback(safe, { code: "c", state: safe.state }))
      ).headers.get("location"),
    ).toBe("/dashboard");

    const hostile = await harness.start("?redirectTo=https%3A%2F%2Fevil.example%2F");
    harness.withTokens();
    expect(
      (
        await harness.answer(
          harness.callback(hostile, { code: "c", state: hostile.state }),
        )
      ).headers.get("location"),
    ).toBe("/");
  });
});
