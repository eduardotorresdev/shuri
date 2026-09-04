import { describe, expect, it } from "vitest";
import { usersCollection } from "../collections.js";
import { toPublicUser } from "./public.js";

describe("toPublicUser", () => {
  it("keeps every declared non-hidden field, plus id", () => {
    expect(
      toPublicUser({
        id: "u1",
        email: "a@b.com",
        name: "Ada",
        emailVerified: true,
        createdAt: 1,
        passwordHash: "$pbkdf2$secret",
      }),
    ).toEqual({
      id: "u1",
      email: "a@b.com",
      name: "Ada",
      emailVerified: true,
      createdAt: 1,
    });
  });

  it("drops a column the schema never declared, so an adapter can't leak one", () => {
    expect(
      toPublicUser({ id: "u1", email: "a@b.com", createdAt: 1, internalNotes: "oops" }),
    ).not.toHaveProperty("internalNotes");
  });

  it("omits a declared field the record doesn't carry, rather than emitting undefined", () => {
    expect(toPublicUser({ id: "u1", email: "a@b.com", createdAt: 1 })).toEqual({
      id: "u1",
      email: "a@b.com",
      createdAt: 1,
    });
  });

  it("drops a field the host marks hidden on its own extended schema, for free", () => {
    const extended = {
      fields: [...usersCollection.fields, { name: "role", hidden: true }],
    };
    expect(
      toPublicUser({ id: "u1", email: "a@b.com", createdAt: 1, role: "admin" }, extended),
    ).not.toHaveProperty("role");
  });
});
