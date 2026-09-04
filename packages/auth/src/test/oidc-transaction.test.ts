import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../create.js";
import { AuthConfigError } from "../errors.js";
import { TRANSACTION_COOKIE_NAME } from "../oidc/transaction.js";
import {
  baseClaims,
  CLIENT_ID,
  createOidcHarness,
  idToken,
  ISSUER,
  TEST_REDIRECT_URI,
  TEST_SECRET,
  type OidcHarness,
} from "../oidc/test-support.js";
import { createAuthStore } from "../test-support.js";

/**
 * Everything that can go wrong between the start route and the callback. The point of most of these
 * is not that they fail, but that they all fail the *same way*.
 */
let harness: OidcHarness;

const GENERIC = { error: "Invalid or expired sign-in transaction" };

beforeEach(() => {
  harness = createOidcHarness();
});

describe("a tampered, missing or mismatched transaction", () => {
  it("gives one identical error however it fails", async () => {
    const started = await harness.start();
    harness.withTokens();

    const tampered = {
      ...started,
      txCookie: `${started.txCookie.split(".")[0]}.tampered-signature`,
    };

    const responses = await Promise.all([
      harness.answer(harness.callback(tampered, { code: "c", state: started.state })),
      harness.answer(harness.callback(started, { code: "c", state: "wrong-state" })),
      harness.answer(
        harness.callback(
          { ...started, txCookie: "" },
          { code: "c", state: started.state },
        ),
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(GENERIC);
    }
  });

  it("refuses an expired transaction", async () => {
    const started = await harness.start();
    harness.withTokens();
    harness.clock.advance(11 * 60 * 1000);

    const response = await harness.answer(
      harness.callback(started, { code: "c", state: started.state }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(GENERIC);
  });

  it("refuses a transaction replayed at another provider's callback", async () => {
    const started = await harness.start();
    const url = new URL("http://localhost/auth/oidc/other/callback");
    url.searchParams.set("code", "c");
    url.searchParams.set("state", started.state);

    const withOther = createAuth({
      store: createAuthStore(),
      cookie: { secure: false },
      secret: TEST_SECRET,
      now: harness.clock,
      fetch: harness.stub.fetch,
      providers: [
        {
          id: "acme",
          issuer: ISSUER,
          clientId: CLIENT_ID,
          redirectUri: TEST_REDIRECT_URI,
        },
        {
          id: "other",
          issuer: ISSUER,
          clientId: CLIENT_ID,
          redirectUri: "https://app.example.com/auth/oidc/other/callback",
        },
      ],
    });

    const response = (await withOther.handler(
      new Request(url, {
        headers: { cookie: `${TRANSACTION_COOKIE_NAME}=${started.txCookie}` },
      }),
    )) as Response;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(GENERIC);
  });

  it("clears the transaction cookie even when it fails", async () => {
    const started = await harness.start();
    const response = await harness.answer(
      harness.callback(started, { code: "c", state: "wrong" }),
    );
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith(`${TRANSACTION_COOKIE_NAME}=`)),
    ).toBe(true);
  });

  it("refuses an id_token echoing another nonce, with the same generic error", async () => {
    const started = await harness.start();
    harness.stub.setTokens({
      id_token: idToken({ ...baseClaims(harness.clock()), nonce: "another-nonce" }),
    });

    const response = await harness.answer(
      harness.callback(started, { code: "c", state: started.state }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(GENERIC);
  });
});

describe("a misbehaving provider", () => {
  it("502s an id_token issued for another client", async () => {
    const started = await harness.start();
    harness.withTokens({ aud: "another-client" });

    expect(
      (
        await harness.answer(
          harness.callback(started, { code: "c", state: started.state }),
        )
      ).status,
    ).toBe(502);
  });

  it("502s a reported error, without echoing its description", async () => {
    const started = await harness.start();

    const response = await harness.answer(
      harness.callback(started, {
        error: "access_denied",
        error_description: "<script>alert(1)</script>",
        state: started.state,
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("script");
  });

  it("502s a rejected token exchange and a callback with no code", async () => {
    const started = await harness.start();
    harness.stub.setTokens(undefined);
    expect(
      (
        await harness.answer(
          harness.callback(started, { code: "c", state: started.state }),
        )
      ).status,
    ).toBe(502);

    const noCode = await harness.start();
    expect(
      (await harness.answer(harness.callback(noCode, { state: noCode.state }))).status,
    ).toBe(502);
  });
});

describe("the OIDC configuration", () => {
  it("requires a signing secret once a provider is declared", () => {
    expect(() =>
      createAuth({
        store: createAuthStore(),
        providers: [
          {
            id: "acme",
            issuer: ISSUER,
            clientId: CLIENT_ID,
            redirectUri: TEST_REDIRECT_URI,
          },
        ],
      }),
    ).toThrow(AuthConfigError);
  });

  it("needs no secret at all without providers", () => {
    expect(() => createAuth({ store: createAuthStore() })).not.toThrow();
  });
});
