import { describe, expect, it } from "vitest";
import { boolean, matches, maxLength, minLength, number, string } from "./primitives.js";
import { all, validate } from "./validators.js";

describe("string", () => {
  it("accepts a string, the empty one included", () => {
    expect(validate("ok", string(), "value")).toEqual([]);
    expect(validate("", string(), "value")).toEqual([]);
  });

  it.each([1, true, null, undefined, {}, []])("flags %p", (value) => {
    expect(validate(value, string(), "value")).toEqual([
      { path: "value", message: "must be a string" },
    ]);
  });

  it("supports a custom message", () => {
    expect(validate(1, string("bad name"), "value")).toEqual([
      { path: "value", message: "bad name" },
    ]);
  });
});

describe("number", () => {
  it("accepts a number, zero and negatives included", () => {
    expect(validate(0, number(), "value")).toEqual([]);
    expect(validate(-1.5, number(), "value")).toEqual([]);
  });

  it("flags NaN, which passes typeof but is never a meaningful value", () => {
    expect(validate(Number.NaN, number(), "value")).toEqual([
      { path: "value", message: "must be a number" },
    ]);
  });

  it.each(["1", true, null, undefined])("flags %p", (value) => {
    expect(validate(value, number(), "value")).toHaveLength(1);
  });
});

describe("boolean", () => {
  it("accepts both booleans", () => {
    expect(validate(true, boolean(), "value")).toEqual([]);
    expect(validate(false, boolean(), "value")).toEqual([]);
  });

  it.each([0, 1, "true", null, undefined])("flags %p", (value) => {
    expect(validate(value, boolean(), "value")).toHaveLength(1);
  });
});

describe("minLength", () => {
  it("accepts a string at or above the minimum", () => {
    expect(validate("abc", minLength(3), "value")).toEqual([]);
  });

  it("flags a shorter string with a derived message", () => {
    expect(validate("ab", minLength(3), "value")).toEqual([
      { path: "value", message: "must be at least 3 characters" },
    ]);
  });

  it("leaves a non-string to string(), so composing reports one issue not two", () => {
    expect(validate(1, minLength(3), "value")).toEqual([]);
    expect(validate(1, all(string(), minLength(3)), "value")).toHaveLength(1);
  });
});

describe("maxLength", () => {
  it("accepts a string at or below the maximum", () => {
    expect(validate("abc", maxLength(3), "value")).toEqual([]);
  });

  it("flags a longer string with a derived message", () => {
    expect(validate("abcd", maxLength(3), "value")).toEqual([
      { path: "value", message: "must be at most 3 characters" },
    ]);
  });

  it("leaves a non-string alone", () => {
    expect(validate({}, maxLength(3), "value")).toEqual([]);
  });
});

describe("matches", () => {
  it("accepts a matching string", () => {
    expect(validate("google", matches(/^[a-z]+$/, "bad id"), "value")).toEqual([]);
  });

  it("flags a non-matching string", () => {
    expect(validate("Google!", matches(/^[a-z]+$/, "bad id"), "value")).toEqual([
      { path: "value", message: "bad id" },
    ]);
  });

  it("leaves a non-string alone", () => {
    expect(validate(1, matches(/^[a-z]+$/, "bad id"), "value")).toEqual([]);
  });

  it("resets lastIndex, so a /g pattern doesn't alternate between calls", () => {
    const validator = matches(/^[a-z]+$/g, "bad id");
    expect(validate("abc", validator, "value")).toEqual([]);
    expect(validate("abc", validator, "value")).toEqual([]);
  });
});
