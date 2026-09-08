import { describe, expect, it } from "vitest";
import { resolveAuthContext } from "../config.js";
import { createAuthStore } from "../test-support.js";
import { authOpenApi } from "./openapi.js";

describe("authOpenApi", () => {
  const fragment = authOpenApi(
    resolveAuthContext(createAuthStore(), {
      basePath: "/account",
      scopes: ["posts:list", "site:read"],
    }),
  );

  it("describes every credential route under the base path", () => {
    expect(Object.keys(fragment.paths).toSorted()).toEqual([
      "/account/login",
      "/account/logout",
      "/account/me",
      "/account/signup",
      "/account/token",
    ]);
  });

  it("publishes the cookie, bearer and client-credentials schemes with the derived scopes", () => {
    expect(fragment.security.schemes).toMatchObject({
      cookieAuth: { type: "apiKey", in: "cookie", name: "shuri_session" },
      bearerAuth: { type: "http", scheme: "bearer" },
      clientCredentials: {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "/account/token",
            scopes: { "posts:list": "list on posts", "site:read": "read on site" },
          },
        },
      },
    });
    expect(fragment.security.requirements("posts:list")).toEqual([
      { cookieAuth: [] },
      { bearerAuth: [] },
      { clientCredentials: ["posts:list"] },
    ]);
  });

  it("describes the OIDC routes of every declared provider", () => {
    const withOidc = authOpenApi(
      resolveAuthContext(createAuthStore(), {
        secret: "x".repeat(32),
        providers: [{ id: "google", preset: "google" }],
      }),
    );
    expect(withOidc.paths["/auth/oidc/google"]).toBeDefined();
    expect(withOidc.paths["/auth/oidc/google/callback"]).toBeDefined();
  });
});
