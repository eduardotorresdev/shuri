import { describe, expect, it } from "vitest";
import { CONVERSION_CASES } from "../testing/conversion-cases.js";
import type { FieldShape } from "../schema/snapshot.js";
import { canonicalJson } from "../schema/canonical-json.js";
import { conversionOf } from "./conversion.js";
import { convertValue } from "./convert-value.js";

const same = (a: unknown, b: unknown): boolean =>
  Object.is(a, b) || canonicalJson(a) === canonicalJson(b);

describe("CONVERSION_CASES", () => {
  it.each(CONVERSION_CASES.map((c, i) => [i, c] as const))(
    "case %i: %j converts as specified",
    (_i, { from, to, input, output }) => {
      expect(convertValue(input, from, to)).toStrictEqual(output);
    },
  );

  it("is idempotent on every case: converting the output again changes nothing", () => {
    for (const { from, to, input } of CONVERSION_CASES) {
      const once = convertValue(input, from, to);
      expect(same(convertValue(once, from, to), once)).toBe(true);
    }
  });

  it("is deterministic: the same call always gives the same answer", () => {
    for (const { from, to, input } of CONVERSION_CASES) {
      expect(same(convertValue(input, from, to), convertValue(input, from, to))).toBe(
        true,
      );
    }
  });

  it("does not mutate array inputs", () => {
    const input = ["a", "b"];
    convertValue(
      input,
      { type: "select", multiple: true },
      { type: "select", multiple: false },
    );
    expect(input).toEqual(["a", "b"]);
  });

  it("covers every classification of the matrix", () => {
    const kinds = new Set(CONVERSION_CASES.map((c) => conversionOf(c.from, c.to)));
    expect(kinds).toEqual(new Set(["identical", "lossless", "lossy"]));
  });

  it("never turns a present value into `undefined` for a lossless pair", () => {
    for (const { from, to, input } of CONVERSION_CASES) {
      if (conversionOf(from, to) !== "lossy" && input !== undefined && input !== null) {
        expect(convertValue(input, from, to)).not.toBeUndefined();
      }
    }
  });
});

const shapes: FieldShape[] = [
  { type: "text" },
  { type: "textarea" },
  { type: "email" },
  { type: "boolean" },
  { type: "number", kind: "integer" },
  { type: "number", kind: "float" },
  { type: "select", multiple: false },
  { type: "select", multiple: true },
  { type: "relation", collection: "a", multiple: false },
  { type: "relation", collection: "a", multiple: true },
  { type: "relation", collection: "b", multiple: false },
];

// Values a field of each shape can validly hold.
const valid = (shape: FieldShape): unknown[] => {
  switch (shape.type) {
    case "text":
    case "textarea":
      return ["", "plain", "42", "-7.5", "true", "false", "a@b.co", " 3 ", "1e3"];
    case "email":
      return ["a@b.co", "x.y@z.org"];
    case "boolean":
      return [true, false];
    case "number":
      return shape.kind === "integer" ? [0, 1, -3, 1000000] : [0, 1.5, -2.25, 3, 1e21];
    case "select":
    case "relation":
      return shape.multiple ? [[], ["a"], ["a", "b", "c"]] : ["a", "b", "42", "true"];
  }
};

// Deterministic pseudo-random values of any JSON type (seeded; no Math.random).
function seeded(count: number): unknown[] {
  let state = 0x2545f491;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)] as T;
  const atom = (): unknown =>
    pick<() => unknown>([
      () => Math.round(next() * 200 - 100),
      () => next() * 200 - 100,
      () =>
        pick(["true", "false", "12", "-3.50", "1e5", "a@b.co", "x@@y", "", " ", "id_7"]),
      () => pick([true, false, null]),
    ])();
  return Array.from({ length: count }, () =>
    next() < 0.25 ? Array.from({ length: Math.floor(next() * 4) }, atom) : atom(),
  );
}

describe("convertValue properties over every pair of shapes", () => {
  const pairs = shapes.flatMap((from) => shapes.map((to) => [from, to] as const));
  const noise = seeded(300);

  it("is idempotent for valid values and for arbitrary JSON values (seeded fuzz)", () => {
    for (const [from, to] of pairs) {
      for (const value of [...valid(from), ...valid(to), ...noise]) {
        const once = convertValue(value, from, to);
        const twice = convertValue(once, from, to);
        if (!same(twice, once)) {
          throw new Error(
            `not idempotent: ${canonicalJson(from)} -> ${canonicalJson(to)} on ${JSON.stringify(value)}: ${JSON.stringify(once)} then ${JSON.stringify(twice)}`,
          );
        }
      }
    }
  });

  it("is lossless where classified so: distinct valid values stay distinct", () => {
    for (const [from, to] of pairs) {
      if (conversionOf(from, to) === "lossy") continue;
      const outputs = valid(from).map((value) => convertValue(value, from, to));
      expect(outputs.every((out) => out !== undefined)).toBe(true);
      expect(new Set(outputs.map((out) => canonicalJson(out))).size).toBe(
        new Set(valid(from).map((v) => canonicalJson(v))).size,
      );
    }
  });

  it("yields a value of the target type or nothing, for numeric and boolean targets", () => {
    for (const [from, to] of pairs) {
      for (const value of valid(from)) {
        const out = convertValue(value, from, to);
        if (to.type === "number" && out !== undefined) {
          expect(typeof out).toBe("number");
          if (to.kind === "integer") expect(Number.isInteger(out)).toBe(true);
        }
        if (to.type === "boolean" && out !== undefined)
          expect(typeof out).toBe("boolean");
      }
    }
  });
});

describe("convertValue edge cases", () => {
  const text: FieldShape = { type: "text" };
  const integer: FieldShape = { type: "number", kind: "integer" };

  it("normalises -0 to 0 so an integer cast and a stored 0 compare equal", () => {
    expect(Object.is(convertValue("-0", text, integer), 0)).toBe(true);
    expect(
      Object.is(convertValue(-0.5, { type: "number", kind: "float" }, integer), 0),
    ).toBe(true);
  });

  it("only treats plain decimals as numbers: no hex, exponent, padding or plus sign", () => {
    for (const s of ["0x10", "1e3", " 5", "+5", "5.", ".5", "1,5", "Infinity", "NaN"]) {
      expect(convertValue(s, text, { type: "number", kind: "float" })).toBeUndefined();
    }
  });

  it("clears a string that overflows to Infinity", () => {
    expect(
      convertValue("9".repeat(400), text, { type: "number", kind: "float" }),
    ).toBeUndefined();
  });

  it("passes null and undefined through every conversion", () => {
    for (const [from, to] of shapes.flatMap((a) => shapes.map((b) => [a, b] as const))) {
      expect(convertValue(null, from, to)).toBeNull();
      expect(convertValue(undefined, from, to)).toBeUndefined();
    }
  });
});
