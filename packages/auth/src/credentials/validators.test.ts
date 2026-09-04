import { describe, expect, it } from "vitest";
import { InvalidCredentialsError } from "../errors.js";
import { MAX_PASSWORD_LENGTH, parseCredentials } from "./validators.js";

describe("parseCredentials", () => {
  it("accepts a well-formed body", () => {
    expect(
      parseCredentials({ email: "a@b.com", password: "correct-horse", name: "Ada" }),
    ).toMatchObject({ email: "a@b.com", password: "correct-horse", name: "Ada" });
  });

  it("requires an email that looks like one", () => {
    expect(() => parseCredentials({ password: "correct-horse" })).toThrow(
      InvalidCredentialsError,
    );
    expect(() => parseCredentials({ email: "nope", password: "correct-horse" })).toThrow(
      InvalidCredentialsError,
    );
  });

  it("enforces a minimum password length", () => {
    expect(() => parseCredentials({ email: "a@b.com", password: "short" })).toThrow(
      InvalidCredentialsError,
    );
  });

  it("caps the password, since every one of them is fed to a KDF", () => {
    expect(() =>
      parseCredentials({
        email: "a@b.com",
        password: "x".repeat(MAX_PASSWORD_LENGTH + 1),
      }),
    ).toThrow(InvalidCredentialsError);
  });

  it("reports every issue at its own body path", () => {
    try {
      parseCredentials({ email: "nope", password: "x" });
      expect.unreachable();
    } catch (error) {
      expect(
        (error as InvalidCredentialsError).issues.map((issue) => issue.path),
      ).toEqual(["body.email", "body.password"]);
    }
  });

  it("rejects a non-string where a string is expected", () => {
    expect(() => parseCredentials({ email: 1, password: "correct-horse" })).toThrow(
      InvalidCredentialsError,
    );
    expect(() =>
      parseCredentials({ email: "a@b.com", password: "correct-horse", name: 1 }),
    ).toThrow(InvalidCredentialsError);
  });
});
