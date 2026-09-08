import { describe, expect, it } from "vitest";
import { ForbiddenError, UnauthenticatedError } from "./errors.js";
import { ANONYMOUS, deny, resolveAccessContext } from "./principal.js";

describe("deny", () => {
  it("answers 401 to anonymous and 403 to anyone identified", () => {
    expect(() => deny(ANONYMOUS)).toThrow(UnauthenticatedError);
    expect(() => deny({ kind: "user", user: { id: "u1" } })).toThrow(ForbiddenError);
    expect(() =>
      deny({ kind: "client", client: { id: "c1", name: "bot" }, scopes: new Set() }),
    ).toThrow(ForbiddenError);
  });
});

describe("resolveAccessContext", () => {
  const request = new Request("http://localhost/");

  it("fills the user shortcut for a user principal", async () => {
    const ctx = await resolveAccessContext(
      { principal: async () => ({ kind: "user", user: { id: "u1" } }) },
      request,
    );
    expect(ctx).toEqual({
      principal: { kind: "user", user: { id: "u1" } },
      user: { id: "u1" },
      request,
    });
  });

  it("fills the client shortcut for a client principal, and neither for anonymous", async () => {
    const client = { id: "c1", name: "bot" };
    const ctx = await resolveAccessContext(
      { principal: async () => ({ kind: "client", client, scopes: new Set(["a:b"]) }) },
      request,
    );
    expect(ctx.client).toBe(client);
    expect(ctx.user).toBeUndefined();

    const anonymous = await resolveAccessContext(
      { principal: async () => ANONYMOUS },
      request,
    );
    expect(anonymous.user).toBeUndefined();
    expect(anonymous.client).toBeUndefined();
  });
});
