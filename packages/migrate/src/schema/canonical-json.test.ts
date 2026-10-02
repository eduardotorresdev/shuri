import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  CanonicalJsonError,
  compareCodePoints,
} from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts object keys at every depth and emits no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("gives the same text for objects that differ only in key order", () => {
    expect(canonicalJson({ x: 1, y: [1, 2], z: "s" })).toBe(
      canonicalJson({ z: "s", y: [1, 2], x: 1 }),
    );
  });

  it("keeps array order (it is meaningful)", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("omits properties whose value is undefined", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("orders keys by code point, not by UTF-16 code unit", () => {
    // U+1F600 is the surrogate pair D83D DE00; U+FFFF is a single unit above D83D.
    const astral = "\u{1F600}";
    const bmp = "￿";
    expect(Object.keys({ [astral]: 1, [bmp]: 1 }).toSorted()).toEqual([astral, bmp]);
    expect(canonicalJson({ [astral]: 1, [bmp]: 2 })).toBe(
      `{${JSON.stringify(bmp)}:2,${JSON.stringify(astral)}:1}`,
    );
  });

  it("serializes numbers like JSON.stringify, with -0 as 0", () => {
    expect(canonicalJson([1, -2.5, 1e21, -0])).toBe("[1,-2.5,1e+21,0]");
  });

  it("escapes strings like JSON.stringify", () => {
    expect(canonicalJson('a"b\n ')).toBe(JSON.stringify('a"b\n '));
  });

  it("accepts null-prototype objects", () => {
    const bare = Object.assign(Object.create(null) as object, { k: 1 });
    expect(canonicalJson(bare)).toBe('{"k":1}');
  });

  it.each([
    ["NaN", Number.NaN, "$"],
    ["Infinity", Number.POSITIVE_INFINITY, "$"],
    ["a top-level undefined", undefined, "$"],
    ["undefined in an array", { list: [1, undefined] }, "$.list[1]"],
    ["a Date", { when: new Date(0) }, "$.when"],
    ["a Map", new Map(), "$"],
    [
      "a class instance",
      {
        v: new (class Foo {
          v = 1;
        })(),
      },
      "$.v",
    ],
    ["a function", { f: () => 1 }, "$.f"],
    ["a bigint", { n: 1n }, "$.n"],
    ["a symbol", { s: Symbol("x") }, "$.s"],
  ])("throws CanonicalJsonError for %s, pointing at the path", (_label, value, path) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
    try {
      canonicalJson(value);
    } catch (error) {
      expect((error as CanonicalJsonError).path).toBe(path);
    }
  });

  it("rejects a circular structure instead of overflowing the stack", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalJson(loop)).toThrow(/circular/);
  });

  it("allows the same object twice when it is not a cycle", () => {
    const shared = { v: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"v":1},"b":{"v":1}}');
  });
});

describe("compareCodePoints", () => {
  it("compares prefixes and equal strings", () => {
    expect(compareCodePoints("a", "a")).toBe(0);
    expect(compareCodePoints("a", "ab")).toBeLessThan(0);
    expect(compareCodePoints("ab", "a")).toBeGreaterThan(0);
  });
});
