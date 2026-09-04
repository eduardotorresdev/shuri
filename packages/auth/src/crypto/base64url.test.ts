import { describe, expect, it } from "vitest";
import {
  decodeBase64Url,
  decodeBase64UrlText,
  encodeBase64Url,
  encodeBase64UrlText,
} from "./base64url.js";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
  });

  it("emits the URL-safe alphabet, unpadded", () => {
    const encoded = encodeBase64Url(new Uint8Array([255, 254, 253]));
    expect(encoded).toBe("__79");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("encodes 32 bytes as 43 characters, the session token's shape", () => {
    expect(encodeBase64Url(new Uint8Array(32))).toHaveLength(43);
  });

  it("round-trips text, non-ASCII included", () => {
    expect(decodeBase64UrlText(encodeBase64UrlText('{"s":"olá"}'))).toBe('{"s":"olá"}');
  });

  it("decodes every unpadded length", () => {
    for (let length = 0; length < 10; length += 1) {
      const bytes = new Uint8Array(length).fill(7);
      expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
    }
  });
});
