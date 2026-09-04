import { describe, expect, it } from "vitest";
import { microsoftProvider } from "./microsoft.js";

const base = {
  clientId: "client-123",
  clientSecret: "s3cret",
  redirectUri: "https://app.example.com/auth/oidc/microsoft/callback",
  tenant: "contoso.onmicrosoft.com",
};

describe("microsoftProvider", () => {
  it('builds the tenant-scoped issuer and defaults to the id "microsoft"', () => {
    const provider = microsoftProvider(base);
    expect(provider).toMatchObject({
      id: "microsoft",
      issuer: "https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0",
      tokenAuthMethod: "client_secret_basic",
    });
  });

  it("lets two tenants coexist under different ids", () => {
    expect(microsoftProvider({ ...base, id: "microsoft-staging" }).id).toBe(
      "microsoft-staging",
    );
  });

  it("scopes the issuer to the tenant it was given", () => {
    expect(
      microsoftProvider({ ...base, tenant: "other-tenant" }).issuer,
    ).toBe("https://login.microsoftonline.com/other-tenant/v2.0");
  });
});
