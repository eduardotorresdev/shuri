import { describe, expect, it } from "vitest";
import { discriminated } from "./discriminated.js";
import { string } from "./primitives.js";
import { objectOf, refine, required, validate } from "./validators.js";

const shape = discriminated("type", {
  circle: objectOf({
    radius: refine<unknown>((v) => typeof v === "number", "must be a number"),
  }),
  label: objectOf({ text: string() }),
});

describe("discriminated", () => {
  it("delegates to the variant picked by the tag", () => {
    expect(validate({ type: "circle", radius: 2 }, shape, "s")).toEqual([]);
    expect(validate({ type: "label", text: "hi" }, shape, "s")).toEqual([]);
  });

  it("keeps the variant's issue paths under the same context", () => {
    expect(validate({ type: "circle", radius: "x" }, shape, "s")).toEqual([
      { path: "s.radius", message: "must be a number" },
    ]);
  });

  it("does not run variants other than the selected one", () => {
    expect(validate({ type: "label", radius: "x", text: "ok" }, shape, "s")).toEqual([]);
  });

  it("flags an unknown tag at the tag's path with the default message", () => {
    expect(validate({ type: "square" }, shape, "s")).toEqual([
      { path: "s.type", message: "must be one of circle, label" },
    ]);
  });

  it("flags a missing or non-string tag the same way", () => {
    const message = "must be one of circle, label";
    expect(validate({}, shape, "s")).toEqual([{ path: "s.type", message }]);
    expect(validate({ type: 1 }, shape, "s")).toEqual([{ path: "s.type", message }]);
  });

  it("does not treat inherited keys as variants", () => {
    expect(validate({ type: "toString" }, shape, "s")).toEqual([
      { path: "s.type", message: "must be one of circle, label" },
    ]);
  });

  it("accepts a static or computed message for an unknown tag", () => {
    const fixed = discriminated("op", { a: required() }, "unknown op");
    expect(validate({ op: "z" }, fixed, "m")).toEqual([
      { path: "m.op", message: "unknown op" },
    ]);
    const computed = discriminated("op", { a: required() }, (t) => `bad op ${String(t)}`);
    expect(validate({ op: "z" }, computed, "m")).toEqual([
      { path: "m.op", message: "bad op z" },
    ]);
  });

  it.each([null, undefined, "str", 3, [{ type: "circle" }]])(
    "flags non-object %p at the current path without reading the tag",
    (value) => {
      expect(validate(value, shape, "s")).toEqual([
        { path: "s", message: "must be an object" },
      ]);
    },
  );
});
