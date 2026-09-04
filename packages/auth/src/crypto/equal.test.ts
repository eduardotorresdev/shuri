import { describe, expect, it } from "vitest";
import { timingSafeEqual } from "./equal.js";

describe("timingSafeEqual", () => {
  it("accepts equal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("rejects strings differing anywhere", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "zbc")).toBe(false);
  });

  it("rejects strings of different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
