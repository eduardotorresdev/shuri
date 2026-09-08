import { validate } from "@shuri/validate";
import { describe, expect, it } from "vitest";
import { COLLECTION_HOOK_NAMES, GLOBAL_HOOK_NAMES } from "./types.js";
import { hooksValidator } from "./validator.js";

describe("hooksValidator", () => {
  const validator = hooksValidator(COLLECTION_HOOK_NAMES);

  it("accepts an absent map, empty arrays and arrays of functions", () => {
    expect(validate(undefined, validator, "hooks")).toEqual([]);
    expect(
      validate(
        { beforeChange: [], afterChange: [() => {}, async () => {}] },
        validator,
        "hooks",
      ),
    ).toEqual([]);
  });

  it("rejects a hook that isn't a function, at its own index", () => {
    expect(validate({ afterChange: [() => {}, "log"] }, validator, "hooks")).toEqual([
      { path: "hooks.afterChange.1", message: '"afterChange" hooks must be functions' },
    ]);
  });

  it("rejects a single function where an array is expected", () => {
    expect(validate({ beforeChange: () => {} }, validator, "hooks")).toEqual([
      { path: "hooks.beforeChange", message: '"beforeChange" must be an array of hooks' },
    ]);
  });

  it("rejects a name the schema kind doesn't have", () => {
    expect(
      validate({ beforeDelete: [] }, hooksValidator(GLOBAL_HOOK_NAMES), "hooks"),
    ).toEqual([
      {
        path: "hooks.beforeDelete",
        message:
          '"beforeDelete" is not a hook (beforeValidate, beforeChange, afterChange, beforeRead, afterRead)',
      },
    ]);
    expect(validate({ onSave: [] }, validator, "hooks")).toEqual([
      {
        path: "hooks.onSave",
        message:
          '"onSave" is not a hook (beforeValidate, beforeChange, afterChange, beforeRead, afterRead, beforeDelete, afterDelete)',
      },
    ]);
  });

  it("rejects a map that isn't an object", () => {
    expect(validate([], validator, "hooks")).toEqual([
      { path: "hooks", message: '"hooks" must be an object' },
    ]);
  });
});
