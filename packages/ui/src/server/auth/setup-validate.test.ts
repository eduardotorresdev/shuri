import { describe, expect, it } from "vitest";
import { toCredentials, validateSetupBody } from "./setup-validate.js";

const valid = { email: "ada@example.com", password: "correct horse battery" };
const paths = (body: unknown): string[] =>
  validateSetupBody(body)
    .map((issue) => issue.path)
    .toSorted();

describe("validateSetupBody", () => {
  it("accepts a minimal body", () => {
    expect(validateSetupBody(valid)).toEqual([]);
  });

  it("accepts an optional name and token alongside it", () => {
    expect(validateSetupBody({ ...valid, name: "Ada", token: "abc" })).toEqual([]);
  });

  it("requires both credentials", () => {
    expect(paths({})).toEqual(["body.email", "body.password"]);
  });

  it("rejects an address that isn't one", () => {
    expect(paths({ ...valid, email: "ada" })).toEqual(["body.email"]);
  });

  it("rejects a password shorter than the floor @shuri/auth also enforces", () => {
    expect(paths({ ...valid, password: "short" })).toEqual(["body.password"]);
  });

  it("rejects a non-string where a string belongs", () => {
    expect(paths({ ...valid, name: 42 })).toEqual(["body.name"]);
    expect(paths({ ...valid, token: {} })).toEqual(["body.token"]);
  });

  it("reports one issue per field, not one per rule broken", () => {
    expect(validateSetupBody({ email: 42, password: "x" })).toHaveLength(2);
  });

  it("refuses a body that isn't an object at all", () => {
    for (const body of [null, "text", 42, ["a"]]) {
      expect(validateSetupBody(body)).toEqual([
        { path: "body", message: "must be an object" },
      ]);
    }
  });
});

describe("toCredentials", () => {
  it("reads the credentials off an accepted body", () => {
    expect(toCredentials({ ...valid, name: "Ada" })).toEqual({ ...valid, name: "Ada" });
  });

  it("leaves `name` out rather than sending an empty one", () => {
    expect(toCredentials(valid)).toEqual(valid);
    expect(toCredentials({ ...valid, name: "" })).toEqual(valid);
  });

  it("drops the token, which is the route's business and not the account's", () => {
    expect(toCredentials({ ...valid, token: "abc" })).toEqual(valid);
  });
});
