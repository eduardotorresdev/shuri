import { describe, expect, it } from "vitest";
import { AuthConfigError } from "../errors.js";
import {
  clearCookie,
  parseCookies,
  readCookie,
  resolveCookieOptions,
  serializeCookie,
} from "./cookie.js";

describe("resolveCookieOptions", () => {
  it("defaults to the secure, HttpOnly, SameSite=Lax session cookie", () => {
    expect(resolveCookieOptions()).toEqual({
      name: "shuri_session",
      secure: true,
      sameSite: "Lax",
      path: "/",
      domain: undefined,
    });
  });

  it("lets a plain-http dev server turn Secure off", () => {
    expect(resolveCookieOptions({ secure: false }).secure).toBe(false);
  });

  it("refuses SameSite=None without Secure, which the browser would drop", () => {
    expect(() => resolveCookieOptions({ sameSite: "None", secure: false })).toThrow(
      AuthConfigError,
    );
  });
});

describe("serializeCookie", () => {
  it("always sets HttpOnly, which is not configurable", () => {
    expect(serializeCookie(resolveCookieOptions(), "token", 60)).toBe(
      "shuri_session=token; Path=/; Max-Age=60; SameSite=Lax; HttpOnly; Secure",
    );
  });

  it("expresses lifetime as Max-Age, immune to a skewed client clock", () => {
    expect(serializeCookie(resolveCookieOptions(), "t", 90.9)).toContain("Max-Age=90");
    expect(serializeCookie(resolveCookieOptions(), "t", -5)).toContain("Max-Age=0");
  });

  it("percent-encodes the value and includes Domain when given", () => {
    const cookie = serializeCookie(
      resolveCookieOptions({ domain: "example.com", secure: false }),
      "a b/c",
      1,
    );
    expect(cookie).toContain("shuri_session=a%20b%2Fc");
    expect(cookie).toContain("Domain=example.com");
    expect(cookie).not.toContain("Secure");
  });
});

describe("clearCookie", () => {
  it("matches the cookie it clears on name, path and domain", () => {
    const options = resolveCookieOptions({ path: "/app", domain: "example.com" });
    const cleared = clearCookie(options);

    expect(cleared).toContain("shuri_session=;");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/app");
    expect(cleared).toContain("Domain=example.com");
  });
});

describe("parseCookies", () => {
  it("returns nothing for a missing header", () => {
    expect(parseCookies(null).size).toBe(0);
  });

  it("splits on the first = only, so a base64 value survives", () => {
    expect(parseCookies("a=Zm9v==; b=1").get("a")).toBe("Zm9v==");
  });

  it("tolerates empty pairs, extra spaces and quotes", () => {
    const cookies = parseCookies(';; a = 1 ;; b="two";');
    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("b")).toBe("two");
  });

  it("keeps the first occurrence of a repeated name", () => {
    expect(parseCookies("a=first; a=second").get("a")).toBe("first");
  });

  it("percent-decodes, and falls back to the raw value on a malformed escape", () => {
    expect(parseCookies("a=x%20y").get("a")).toBe("x y");
    // decodeURIComponent throws URIError here; a junk third-party cookie can't 500 a request.
    expect(parseCookies("a=100%; b=2").get("a")).toBe("100%");
    expect(parseCookies("a=100%; b=2").get("b")).toBe("2");
  });
});

describe("readCookie", () => {
  it("reads one cookie off a request", () => {
    const request = new Request("http://localhost/", {
      headers: { cookie: "shuri_session=tok" },
    });
    expect(readCookie(request, "shuri_session")).toBe("tok");
    expect(readCookie(request, "other")).toBeUndefined();
  });
});
