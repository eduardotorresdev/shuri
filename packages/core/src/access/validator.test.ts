import { validate } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import { COLLECTION_ACCESS_OPS, GLOBAL_ACCESS_OPS } from "./types.js";
import { accessValidator } from "./validator.js";

describe("accessValidator", () => {
  const validator = accessValidator(COLLECTION_ACCESS_OPS);

  it("accepts an absent map, booleans and functions", () => {
    expect(validate(undefined, validator, "access")).toEqual([]);
    expect(
      validate({ list: true, view: () => false, create: async () => true }, validator),
    ).toEqual([]);
  });

  it("rejects a rule that is neither", () => {
    expect(validate({ list: "yes" }, validator, "access")).toEqual([
      { path: "access.list", message: '"list" must be a boolean or a function' },
    ]);
  });

  it("rejects an op the schema kind doesn't have", () => {
    expect(
      validate({ read: true }, accessValidator(GLOBAL_ACCESS_OPS), "access"),
    ).toEqual([]);
    expect(validate({ read: true }, validator, "access")).toEqual([
      {
        path: "access.read",
        message: '"read" is not an access operation (create, list, view, update, delete)',
      },
    ]);
  });

  it("rejects a map that isn't an object", () => {
    expect(validate(true, validator, "access")).toEqual([
      { path: "access", message: '"access" must be an object' },
    ]);
  });
});
