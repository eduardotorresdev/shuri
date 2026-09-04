import { describe, expect, it } from "vitest";
import { matchAuthRoute } from "./routes.js";

describe("matchAuthRoute", () => {
  it.each(["signup", "login", "logout", "me"] as const)("matches /%s", (name) => {
    expect(matchAuthRoute(`/auth/${name}`, "/auth")).toEqual({ name });
  });

  it("tolerates a trailing slash", () => {
    expect(matchAuthRoute("/auth/me/", "/auth")).toEqual({ name: "me" });
  });

  it("matches the two OIDC routes and extracts the provider", () => {
    expect(matchAuthRoute("/auth/oidc/google", "/auth")).toEqual({
      name: "oidc-start",
      provider: "google",
    });
    expect(matchAuthRoute("/auth/oidc/google/callback", "/auth")).toEqual({
      name: "oidc-callback",
      provider: "google",
    });
  });

  it("honors a custom base path", () => {
    expect(matchAuthRoute("/api/auth/me", "/api/auth")).toEqual({ name: "me" });
  });

  it.each([
    ["outside the base path", "/collections/posts"],
    ["the base path itself", "/auth"],
    ["an unknown route", "/auth/nope"],
    ["extra segments", "/auth/me/extra"],
    ["oidc without a provider", "/auth/oidc"],
    ["an unknown oidc sub-route", "/auth/oidc/google/token"],
  ])("declines %s, falling through to the next handler", (_name, pathname) => {
    expect(matchAuthRoute(pathname, "/auth")).toBeUndefined();
  });
});
