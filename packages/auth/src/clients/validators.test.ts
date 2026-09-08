import { describe, expect, it } from "vitest";
import { ClientsConfigError, UnknownRoleError } from "../errors.js";
import { assertKnownRoles, assertValidClientsConfig } from "./validators.js";

describe("assertValidClientsConfig", () => {
  it("accepts nothing, and a well-formed config", () => {
    expect(() => assertValidClientsConfig(undefined)).not.toThrow();
    expect(() =>
      assertValidClientsConfig({
        roles: { admin: ["*"], integrator: ["posts:*", "*:list", "site:read"] },
        tokenTtlMs: 60_000,
      }),
    ).not.toThrow();
  });

  it("rejects a pattern that isn't a scope pattern, at its own path", () => {
    expect(() => assertValidClientsConfig({ roles: { bad: ["posts"] } })).toThrow(
      ClientsConfigError,
    );
    try {
      assertValidClientsConfig({ roles: { bad: ["posts", 3 as never] } });
    } catch (error) {
      expect((error as ClientsConfigError).issues.map((issue) => issue.path)).toEqual([
        "auth.clients.roles.bad.0",
        "auth.clients.roles.bad.1",
      ]);
    }
  });

  it("rejects a non-positive or fractional TTL", () => {
    expect(() => assertValidClientsConfig({ roles: {}, tokenTtlMs: 0 })).toThrow(
      ClientsConfigError,
    );
    expect(() => assertValidClientsConfig({ roles: {}, tokenTtlMs: 1.5 })).toThrow(
      ClientsConfigError,
    );
  });
});

describe("assertKnownRoles", () => {
  it("names the unknown role and the declared ones", () => {
    expect(() => assertKnownRoles(["admin"], ["admin", "reader"])).not.toThrow();
    expect(() => assertKnownRoles(["writer"], ["admin", "reader"])).toThrow(
      'unknown role "writer"; declared roles: admin, reader',
    );
    expect(() => assertKnownRoles(["writer"], [])).toThrow(UnknownRoleError);
  });
});
