import type { AuthUser } from "@shuri/auth";
import { describe, expect, it } from "vitest";
import { toAdminUser } from "./user.js";

const user: AuthUser = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  createdAt: 0,
  passwordHash: "never-leaves",
  internalNote: "nor this",
};

describe("toAdminUser", () => {
  it("keeps only the fields the admin's header shows", () => {
    expect(toAdminUser(user)).toEqual({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
    });
  });

  it("drops every extra field the host declared on users", () => {
    expect(JSON.stringify(toAdminUser(user))).not.toContain("never-leaves");
    expect(Object.keys(toAdminUser(user))).toEqual(["id", "email", "name"]);
  });

  it("leaves `name` out rather than sending it undefined", () => {
    const nameless: AuthUser = { id: "u2", email: "b@c.com", createdAt: 0 };

    expect(Object.keys(toAdminUser(nameless))).toEqual(["id", "email"]);
  });
});
