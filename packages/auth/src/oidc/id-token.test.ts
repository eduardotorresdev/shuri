import { describe, expect, it } from "vitest";
import { OAuthTransactionError, OidcProviderError } from "../errors.js";
import { assertValidClaims, decodeIdToken, MAX_TOKEN_AGE_MS } from "./id-token.js";
import { baseClaims, CLIENT_ID, idToken, ISSUER } from "./test-support.js";

const now = 1_700_000_000_000;
const expectations = { issuer: ISSUER, clientId: CLIENT_ID, nonce: "nonce-value", now };

function check(overrides: Record<string, unknown>): void {
  assertValidClaims(
    { ...baseClaims(now), nonce: "nonce-value", ...overrides },
    expectations,
  );
}

describe("decodeIdToken", () => {
  it("decodes the claims segment", () => {
    expect(decodeIdToken(idToken(baseClaims(now)))).toMatchObject({
      iss: ISSUER,
      sub: "subject-1",
    });
  });

  it.each(["", "a.b", "a.b.c.d", "a.!!.c"])("refuses the malformed token %p", (token) => {
    expect(() => decodeIdToken(token)).toThrow(OidcProviderError);
  });
});

describe("assertValidClaims", () => {
  it("accepts well-formed claims", () => {
    expect(() => check({})).not.toThrow();
  });

  it("accepts an aud array containing our client, with a matching azp", () => {
    expect(() => check({ aud: ["other", CLIENT_ID], azp: CLIENT_ID })).not.toThrow();
  });

  it("refuses another issuer, another audience and another authorized party", () => {
    expect(() => check({ iss: "https://evil.example.com" })).toThrow(OidcProviderError);
    expect(() => check({ aud: "another-client" })).toThrow(OidcProviderError);
    expect(() => check({ azp: "another-client" })).toThrow(OidcProviderError);
  });

  it("refuses an expired token, tolerating a minute of clock skew", () => {
    expect(() => check({ exp: Math.floor(now / 1000) - 30 })).not.toThrow();
    expect(() => check({ exp: Math.floor(now / 1000) - 120 })).toThrow(/expired/);
  });

  it("refuses a token issued in the future or too long ago", () => {
    expect(() => check({ iat: Math.floor(now / 1000) + 120 })).toThrow(/future/);
    expect(() =>
      check({ iat: Math.floor((now - MAX_TOKEN_AGE_MS - 1000) / 1000) }),
    ).toThrow(/too old/);
  });

  it("refuses a token with no usable subject", () => {
    expect(() => check({ sub: "" })).toThrow(/subject/);
    expect(() => check({ sub: 1 })).toThrow(/subject/);
  });

  it("refuses a nonce that isn't this transaction's, with the generic transaction error", () => {
    expect(() => check({ nonce: "another-nonce" })).toThrow(OAuthTransactionError);
    expect(() => check({ nonce: undefined })).toThrow(OAuthTransactionError);
  });

  it("skips the issuer check when the provider declared endpoints instead", () => {
    assertValidClaims(
      { ...baseClaims(now), nonce: "nonce-value", iss: "https://whatever.example" },
      { ...expectations, issuer: undefined },
    );
  });
});
