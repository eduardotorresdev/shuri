import { describe, expect, it } from "vitest";
import { weakEtag } from "./etag.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("weakEtag", () => {
  it("is stable for the same bytes", () => {
    expect(weakEtag(bytes("<html>"))).toBe(weakEtag(bytes("<html>")));
  });

  it("changes when the content does, including at the same length", () => {
    expect(weakEtag(bytes("aaaa"))).not.toBe(weakEtag(bytes("aaab")));
  });

  it("is marked weak, since it promises nothing byte-for-byte", () => {
    expect(weakEtag(bytes("x"))).toMatch(/^W\/"/);
  });
});
