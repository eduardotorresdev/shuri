import { describe, expect, it } from "vitest";
import { randomBytes, randomToken } from "./random.js";

describe("randomToken", () => {
  it("is 43 base64url characters, i.e. 32 bytes of entropy", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats across a sample", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken()));
    expect(tokens.size).toBe(500);
  });
});

describe("randomBytes", () => {
  it("returns the requested length", () => {
    expect(randomBytes(16)).toHaveLength(16);
  });
});
