import { describe, expect, it } from "vitest";
import { safeRedirect } from "./redirect.js";

const policy = { fallback: "/" };

describe("safeRedirect", () => {
  it("honors a same-site path", () => {
    expect(safeRedirect("/dashboard?tab=1", policy)).toBe("/dashboard?tab=1");
  });

  it("falls back when nothing was requested", () => {
    expect(safeRedirect(undefined, policy)).toBe("/");
    expect(safeRedirect(null, policy)).toBe("/");
    expect(safeRedirect("", policy)).toBe("/");
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["backslash protocol-relative", "/\\evil.example"],
    ["absolute with a scheme", "https://evil.example/"],
    ["javascript scheme", "javascript:alert(1)"],
    ["relative without a leading slash", "dashboard"],
  ])("refuses %s, the credential-phishing shape", (_name, target) => {
    expect(safeRedirect(target, policy)).toBe("/");
  });

  it("refuses control characters, which can smuggle a header break", () => {
    expect(safeRedirect("/ok\r\nSet-Cookie: a=b", policy)).toBe("/");
  });

  it("honors an absolute URL only when its origin is allowed", () => {
    const withOrigins = {
      fallback: "/",
      allowedOrigins: ["https://app.example.com"],
    };
    expect(safeRedirect("https://app.example.com/home", withOrigins)).toBe(
      "https://app.example.com/home",
    );
    expect(safeRedirect("https://evil.example/home", withOrigins)).toBe("/");
  });
});
