import { describe, expect, it } from "vitest";
import { OidcConfigError } from "../errors.js";
import { oidcProvider } from "./config.js";
import { googleProvider } from "./presets/google.js";

const base = {
  id: "acme",
  issuer: "https://idp.example.com",
  clientId: "client-123",
  redirectUri: "https://app.example.com/auth/oidc/acme/callback",
};

describe("oidcProvider", () => {
  it("fills in the defaults", () => {
    expect(oidcProvider(base)).toMatchObject({
      scopes: ["openid", "email", "profile"],
      tokenAuthMethod: "none",
      authorizationParams: {},
      allowLinkingByVerifiedEmail: true,
      fetchUserInfo: false,
    });
  });

  it("treats a client with a secret as a confidential one", () => {
    expect(oidcProvider({ ...base, clientSecret: "s3cret" }).tokenAuthMethod).toBe(
      "client_secret_basic",
    );
  });

  it("requires an issuer or explicit endpoints", () => {
    const { issuer: _issuer, ...withoutIssuer } = base;
    expect(() => oidcProvider(withoutIssuer)).toThrow(OidcConfigError);
    expect(() =>
      oidcProvider({
        ...withoutIssuer,
        endpoints: {
          authorization: "https://idp.example.com/authorize",
          token: "https://idp.example.com/token",
        },
      }),
    ).not.toThrow();
  });

  it("refuses a non-https issuer or endpoint", () => {
    expect(() => oidcProvider({ ...base, issuer: "http://idp.example.com" })).toThrow(
      OidcConfigError,
    );
    expect(() =>
      oidcProvider({
        ...base,
        endpoints: {
          authorization: "http://idp.example.com/authorize",
          token: "https://idp.example.com/token",
        },
      }),
    ).toThrow(OidcConfigError);
  });

  it("refuses an id that wouldn't survive a URL path segment", () => {
    expect(() => oidcProvider({ ...base, id: "Acme Provider" })).toThrow(OidcConfigError);
  });

  it("requires the pieces it can't work without", () => {
    expect(() => oidcProvider({ ...base, clientId: "" })).toThrow(OidcConfigError);
    expect(() => oidcProvider({ ...base, redirectUri: "" })).toThrow(OidcConfigError);
  });

  it("refuses client_secret_basic without a secret", () => {
    expect(() =>
      oidcProvider({ ...base, tokenAuthMethod: "client_secret_basic" }),
    ).toThrow(OidcConfigError);
  });
});

describe("googleProvider", () => {
  it('fills in Google\'s issuer and defaults to the id "google"', () => {
    const provider = googleProvider({
      clientId: "client-123",
      clientSecret: "s3cret",
      redirectUri: "https://app.example.com/auth/oidc/google/callback",
    });
    expect(provider).toMatchObject({
      id: "google",
      issuer: "https://accounts.google.com",
      tokenAuthMethod: "client_secret_basic",
    });
  });

  it("lets two Google tenants coexist under different ids", () => {
    expect(
      googleProvider({
        id: "google-work",
        clientId: "client-123",
        redirectUri: "https://app.example.com/cb",
      }).id,
    ).toBe("google-work");
  });
});
