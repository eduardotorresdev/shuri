import { describe, expect, it } from "vitest";
import { parseNewUser, parseUserPatch, UserValidationError } from "./validate.js";

const issuesOf = (attempt: () => unknown) => {
  try {
    attempt();
  } catch (error) {
    if (error instanceof UserValidationError) return error.issues;
    throw error;
  }
  return [];
};

describe("parseNewUser", () => {
  it("accepts an email alone: a password is optional on create", () => {
    expect(parseNewUser({ email: "ada@example.com" })).toEqual({
      email: "ada@example.com",
    });
  });

  it("requires the email, rooting the issue at the field for the form", () => {
    expect(issuesOf(() => parseNewUser({}))).toEqual([
      { path: "email", message: '"email" is required' },
    ]);
  });

  it("checks the email's shape and the password's length", () => {
    expect(issuesOf(() => parseNewUser({ email: "nope", password: "short" }))).toEqual([
      { path: "email", message: '"email" must be a valid email' },
      { path: "password", message: '"password" must be at least 8 characters' },
    ]);
  });

  it("refuses a field it doesn't know rather than dropping it", () => {
    expect(
      issuesOf(() => parseNewUser({ email: "ada@example.com", passwordHash: "x" })),
    ).toEqual([{ path: "passwordHash", message: '"passwordHash" is not a user field' }]);
  });

  it("refuses a body that isn't an object", () => {
    expect(issuesOf(() => parseNewUser([]))).toEqual([
      { path: "", message: "must be an object" },
    ]);
  });
});

describe("parseUserPatch", () => {
  it("accepts any subset, the email included", () => {
    expect(parseUserPatch({ name: "Ada", emailVerified: true })).toEqual({
      name: "Ada",
      emailVerified: true,
    });
    expect(parseUserPatch({})).toEqual({});
  });

  it("checks the types of what it is given", () => {
    expect(issuesOf(() => parseUserPatch({ emailVerified: "yes" }))).toEqual([
      { path: "emailVerified", message: '"emailVerified" must be a boolean' },
    ]);
  });
});
