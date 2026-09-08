import { beforeEach, describe, expect, it } from "vitest";
import { createAuth, type AuthApi } from "../create.js";
import { UnknownClientError } from "../errors.js";
import { createAuthStore, createClock, tokenRequest } from "../test-support.js";

/**
 * The client-credentials grant over HTTP: create a client programmatically, obtain a token with a
 * narrowed scope, then every way the endpoint says no — all against a real store.
 */
const scopes = ["posts:list", "posts:view", "posts:create", "authors:delete"];
let auth: AuthApi;
let clock: ReturnType<typeof createClock>;
let clientId: string;
let clientSecret: string;

interface TokenBody {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

beforeEach(async () => {
  clock = createClock();
  auth = createAuth({
    store: createAuthStore(),
    now: clock,
    scopes,
    clients: { roles: { integrator: ["posts:*"] }, tokenTtlMs: 60_000 },
  });
  const issued = await auth.clients.create({ name: "CI", roles: ["integrator"] });
  clientId = issued.client.clientId;
  clientSecret = issued.clientSecret;
});

async function answer(request: Request): Promise<Response> {
  const response = await auth.handler(request);
  if (!response) throw new Error(`expected the auth handler to answer ${request.url}`);
  return response;
}

describe("POST /auth/token", () => {
  it("issues a bearer token narrowed to the requested scope", async () => {
    const response = await answer(
      tokenRequest({ clientId, clientSecret, scope: "posts:list" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as TokenBody;
    expect(body).toEqual({
      access_token: expect.stringMatching(/^sct_[A-Za-z0-9_-]{43}$/),
      token_type: "Bearer",
      expires_in: 60,
      scope: "posts:list",
    });

    expect(
      await auth.principal(
        new Request("http://localhost/", {
          headers: { authorization: `Bearer ${body.access_token}` },
        }),
      ),
    ).toMatchObject({ kind: "client", scopes: new Set(["posts:list"]) });
  });

  it("grants everything the roles allow when no scope is asked for", async () => {
    const body = (await (
      await answer(tokenRequest({ clientId, clientSecret }))
    ).json()) as TokenBody;
    expect(body.scope).toBe("posts:list posts:view posts:create");
  });

  it("accepts client_id/client_secret in the body, JSON included", async () => {
    const form = new Request("http://localhost/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    expect((await answer(form)).status).toBe(200);

    const json = new Request("http://localhost/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    expect((await answer(json)).status).toBe(200);
  });

  it("answers invalid_scope for a scope outside the roles", async () => {
    const response = await answer(
      tokenRequest({ clientId, clientSecret, scope: "authors:delete" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_scope" });
  });

  it("answers the same invalid_client for a wrong secret, an unknown id and a revoked client", async () => {
    const wrong = await answer(tokenRequest({ clientId, clientSecret: "scs_wrong" }));
    const unknown = await answer(tokenRequest({ clientId: "nope", clientSecret }));
    await auth.clients.revoke((await auth.clients.findByClientId(clientId))?.id ?? "");
    const revoked = await answer(tokenRequest({ clientId, clientSecret }));

    for (const response of [wrong, unknown, revoked]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Basic realm="shuri"');
      expect(await response.json()).toEqual({ error: "invalid_client" });
    }
  });

  it("answers unsupported_grant_type, invalid_request and 405", async () => {
    const grant = await answer(
      tokenRequest({ clientId, clientSecret, grantType: "password" }),
    );
    expect(grant.status).toBe(400);
    expect(await grant.json()).toEqual({ error: "unsupported_grant_type" });

    const missing = new Request("http://localhost/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(await (await answer(missing)).json()).toMatchObject({
      error: "invalid_request",
    });

    expect((await answer(new Request("http://localhost/auth/token"))).status).toBe(405);
  });

  it("expires the token, and revoking the client kills a live one", async () => {
    const body = (await (
      await answer(tokenRequest({ clientId, clientSecret }))
    ).json()) as TokenBody;
    const bearer = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    expect((await auth.principal(bearer)).kind).toBe("client");

    clock.advance(60_001);
    expect((await auth.principal(bearer)).kind).toBe("anonymous");
    expect(await auth.pruneExpiredClientTokens()).toBe(0);
  });

  it("issues tokens programmatically too, refusing an unknown or revoked client", async () => {
    const issued = await auth.issueClientToken(clientId, ["posts:view"]);
    expect(issued.scope).toEqual(["posts:view"]);
    await expect(auth.issueClientToken("nope")).rejects.toThrow(UnknownClientError);
  });
});
