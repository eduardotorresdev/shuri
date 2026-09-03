import { describe, expect, it } from "vitest";
import { ValidationError, formatIssue, formatIssues } from "./errors.js";
import {
  all,
  array,
  arrayOf,
  assertValid,
  keyedArray,
  nonEmpty,
  object,
  oneOf,
  optional,
  record,
  refine,
  required,
  unique,
  validate,
} from "./validators.js";

describe("validate", () => {
  it("returns no issues when the validator adds none", () => {
    expect(validate({ name: "ok" }, required(), "value")).toEqual([]);
  });

  it("collects issues with the path built up via ctx.at", () => {
    const person = object<{ name: string }>({ name: required('"name" is required') });
    const issues = validate({ name: "" }, person, "person");
    expect(issues).toEqual([{ path: "person.name", message: '"name" is required' }]);
  });
});

describe("required", () => {
  it.each([undefined, null, ""])("flags %p as missing", (value) => {
    expect(validate(value, required(), "value")).toHaveLength(1);
  });

  it("accepts any other value", () => {
    expect(validate(0, required(), "value")).toEqual([]);
    expect(validate(false, required(), "value")).toEqual([]);
  });
});

describe("refine", () => {
  it("adds a static message when the check fails", () => {
    const positive = refine<number>((value) => value > 0, "must be positive");
    expect(validate(-1, positive, "amount")).toEqual([{ path: "amount", message: "must be positive" }]);
    expect(validate(1, positive, "amount")).toEqual([]);
  });

  it("supports a message derived from the value", () => {
    const positive = refine<number>((value) => value > 0, (value) => `${value} must be positive`);
    expect(validate(-1, positive, "amount")).toEqual([{ path: "amount", message: "-1 must be positive" }]);
  });
});

describe("optional", () => {
  it("skips the wrapped validator when the value is undefined", () => {
    expect(validate(undefined, optional(required()), "value")).toEqual([]);
  });

  it("runs the wrapped validator otherwise", () => {
    expect(validate("", optional(required()), "value")).toHaveLength(1);
  });
});

describe("oneOf", () => {
  it("accepts an allowed value", () => {
    expect(validate("asc", oneOf(["asc", "desc"]), "direction")).toEqual([]);
  });

  it("flags a value outside the allowed set with a default message", () => {
    expect(validate("up", oneOf(["asc", "desc"]), "direction")).toEqual([
      { path: "direction", message: "must be one of asc, desc" },
    ]);
  });

  it("supports a custom message", () => {
    expect(validate("up", oneOf(["asc", "desc"], "bad direction"), "direction")).toEqual([
      { path: "direction", message: "bad direction" },
    ]);
  });
});

describe("arrayOf", () => {
  it("validates each item once confirmed to be an array", () => {
    const items = arrayOf<{ name: string }>(object({ name: required('"name" is required') }));
    expect(validate([{ name: "ok" }, { name: "" }], items, "items")).toEqual([
      { path: "items.1.name", message: '"name" is required' },
    ]);
  });

  it("flags a non-array value instead of throwing", () => {
    expect(validate("not an array", arrayOf(required()), "items")).toEqual([
      { path: "items", message: "must be an array" },
    ]);
  });
});

describe("record", () => {
  it("validates every value at its own key", () => {
    const filters = record<number>(refine((value) => value > 0, "must be positive"));
    expect(validate({ a: 1, b: -1 }, filters, "where")).toEqual([{ path: "where.b", message: "must be positive" }]);
  });

  it("flags a non-object value instead of throwing", () => {
    expect(validate([1, 2], record(required()), "where")).toEqual([{ path: "where", message: "must be an object" }]);
    expect(validate("nope", record(required()), "where")).toEqual([{ path: "where", message: "must be an object" }]);
  });
});

describe("all", () => {
  it("runs every validator and merges their issues", () => {
    const validator = all<number>(
      refine((value) => value > 0, "must be positive"),
      refine((value) => Number.isInteger(value), "must be an integer"),
    );
    expect(validate(-1.5, validator, "amount")).toEqual([
      { path: "amount", message: "must be positive" },
      { path: "amount", message: "must be an integer" },
    ]);
  });
});

describe("array / keyedArray", () => {
  interface Item {
    name: string;
  }

  it("validates each item at its numeric index", () => {
    const items = array<Item>(object({ name: required('"name" is required') }));
    const issues = validate([{ name: "ok" }, { name: "" }], items, "items");
    expect(issues).toEqual([{ path: "items.1.name", message: '"name" is required' }]);
  });

  it("validates each item at a caller-provided key", () => {
    const items = keyedArray<Item>(
      (item) => item.name || "(missing name)",
      object({ name: required('"name" is required') }),
    );
    const issues = validate([{ name: "" }], items, "items");
    expect(issues).toEqual([{ path: "items.(missing name).name", message: '"name" is required' }]);
  });

  it("flags duplicate keys at the duplicate item's own path", () => {
    const items = keyedArray<Item>((item) => item.name, object({}), {
      duplicateMessage: (key) => `duplicate name "${key}"`,
    });
    const issues = validate([{ name: "a" }, { name: "a" }, { name: "b" }], items, "items");
    expect(issues).toEqual([{ path: "items.a", message: 'duplicate name "a"' }]);
  });
});

describe("nonEmpty", () => {
  it("flags an empty array", () => {
    expect(validate([], nonEmpty("must not be empty"), "items")).toEqual([
      { path: "items", message: "must not be empty" },
    ]);
  });

  it("accepts a non-empty array", () => {
    expect(validate([1], nonEmpty("must not be empty"), "items")).toEqual([]);
  });
});

describe("unique", () => {
  it("flags every item sharing a key after the first, at the collection path", () => {
    const distinctSlugs = unique<{ slug: string }>(
      (item) => item.slug,
      (key) => `duplicate slug "${key}"`,
    );
    const issues = validate([{ slug: "a" }, { slug: "a" }, { slug: "b" }], distinctSlugs, "items");
    expect(issues).toEqual([{ path: "items", message: 'duplicate slug "a"' }]);
  });
});

describe("assertValid", () => {
  it("does not throw when there are no issues", () => {
    expect(() => assertValid("ok", required(), "value")).not.toThrow();
  });

  it("throws a ValidationError carrying every issue", () => {
    const items = array<{ name: string }>(object({ name: required('"name" is required') }));
    expect(() => assertValid([{ name: "" }], items, "items")).toThrow(ValidationError);
  });
});

describe("formatIssue / formatIssues", () => {
  it("formats a single issue as `path: message`", () => {
    expect(formatIssue({ path: "a.b", message: "is required" })).toBe("a.b: is required");
  });

  it("formats a single-issue list without a bullet list", () => {
    expect(formatIssues([{ path: "a", message: "bad" }])).toBe("a: bad");
  });

  it("formats multiple issues as a bulleted list", () => {
    const message = formatIssues([
      { path: "a", message: "bad" },
      { path: "b", message: "worse" },
    ]);
    expect(message).toBe("Invalid schema:\n  - a: bad\n  - b: worse");
  });
});
