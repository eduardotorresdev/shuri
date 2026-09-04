import { beforeEach, describe, expect, it } from "vitest";
import { createAuth, type AuthApi } from "../create.js";
import {
  baseClaims,
  createFetchStub,
  discoveryDocument,
  idToken,
  type FetchStub,
} from "../oidc/test-support.js";
import { TRANSACTION_COOKIE_NAME } from "../oidc/transaction.js";
import { createAuthStore, createClock, createTestHasher, readSetCookie } from "../test-support.js";

/**
 * A slot-declared provider (`{ id, preset }`, no credentials in code) is completed from its
 * `_oidc_credentials` row at request time — this is the mechanism `googleProvider`'s "just the keys"
 * promise depends on.
 */
const GOOGLE_ISSUER = "https://accounts.google.com";
const CLIENT_ID = "client-123";

let auth: AuthApi;
let stub: FetchStub;
let clock: ReturnType<typeof createClock>;

beforeEach(() => {
  clock = createClock();
  stub = createFetchStub();
  stub.setDiscovery(
    discoveryDocument({
      issuer: GOOGLE_ISSUER,
      authorization_endpoint: `${GOOGLE_ISSUER}/authorize`,
      token_endpoint: `${GOOGLE_ISSUER}/token`,
      userinfo_endpoint: `${GOOGLE_ISSUER}/userinfo`,
    }),
  );

  auth = createAuth({
    store: createAuthStore(),
    hasher: createTestHasher(),
    cookie: { secure: false },
    secret: "a-signing-secret-of-32-characters",
    now: clock,
    fetch: stub.fetch,
    providers: [{ id: "google", preset: "google" }],
  });
});

async function answer(request: Request): Promise<Response> {
  const response = await auth.handler(request);
  if (!response) throw new Error(`expected the auth handler to answer ${request.url}`);
  return response;
}

describe("a slot-declared provider", () => {
  it("404s when its _oidc_credentials row hasn't been created yet", async () => {
    expect((await answer(new Request("http://localhost/auth/oidc/google"))).status).toBe(404);
  });

  it("signs in once an admin fills in its credentials", async () => {
    await auth.oidcCredentials.insert({
      provider: "google",
      clientId: CLIENT_ID,
      clientSecret: "s3cret",
      redirectUri: "https://app.example.com/auth/oidc/google/callback",
    });

    const start = await answer(new Request("http://localhost/auth/oidc/google"));
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe(`${GOOGLE_ISSUER}/authorize`);
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);

    const nonce = location.searchParams.get("nonce") as string;
    const state = location.searchParams.get("state") as string;
    const txCookie = readSetCookie(start, TRANSACTION_COOKIE_NAME) as string;

    stub.setTokens({
      id_token: idToken(baseClaims(clock(), { iss: GOOGLE_ISSUER, aud: CLIENT_ID, nonce })),
      token_type: "Bearer",
    });

    const callbackUrl = new URL("http://localhost/auth/oidc/google/callback");
    callbackUrl.searchParams.set("code", "auth-code");
    callbackUrl.searchParams.set("state", state);
    const callback = await answer(
      new Request(callbackUrl, {
        headers: { cookie: `${TRANSACTION_COOKIE_NAME}=${txCookie}` },
      }),
    );

    expect(callback.status).toBe(302);
    expect(readSetCookie(callback)).toBeDefined();
  });

  it("stops resolving a provider once its credentials row is deleted mid-flow, and still clears the transaction cookie", async () => {
    const row = await auth.oidcCredentials.insert({
      provider: "google",
      clientId: CLIENT_ID,
      redirectUri: "https://app.example.com/auth/oidc/google/callback",
    });

    const start = await answer(new Request("http://localhost/auth/oidc/google"));
    const location = new URL(start.headers.get("location") as string);
    const state = location.searchParams.get("state") as string;
    const txCookie = readSetCookie(start, TRANSACTION_COOKIE_NAME) as string;

    await auth.oidcCredentials.delete(row.id);

    const callbackUrl = new URL("http://localhost/auth/oidc/google/callback");
    callbackUrl.searchParams.set("code", "auth-code");
    callbackUrl.searchParams.set("state", state);
    const callback = await answer(
      new Request(callbackUrl, {
        headers: { cookie: `${TRANSACTION_COOKIE_NAME}=${txCookie}` },
      }),
    );

    expect(callback.status).toBe(404);
    const cookies = callback.headers.getSetCookie();
    expect(
      cookies.some(
        (cookie) =>
          cookie.startsWith(`${TRANSACTION_COOKIE_NAME}=`) && cookie.includes("Max-Age=0"),
      ),
    ).toBe(true);
  });
});
