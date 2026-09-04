import { describe, expect, it } from "vitest";
import { resolveCookieOptions } from "../http/cookie.js";
import { createClock } from "../test-support.js";
import { createSessionCookies } from "./cookie.js";

const clock = createClock();
const options = resolveCookieOptions({ secure: false });
const cookies = createSessionCookies(options, clock);

describe("createSessionCookies", () => {
  it("derives Max-Age from the absolute expiry", () => {
    expect(cookies.issue("tok", clock() + 60_000)).toContain("Max-Age=60");
  });

  it("clears with the very options it issued with, or the original would survive", () => {
    const scoped = createSessionCookies(
      resolveCookieOptions({ path: "/app", secure: false }),
      clock,
    );
    expect(scoped.issue("tok", clock() + 1000)).toContain("Path=/app");
    expect(scoped.clear()).toContain("Path=/app");
    expect(scoped.clear()).toContain("Max-Age=0");
  });

  it("reads the cookie off a request", () => {
    const request = new Request("http://localhost/", {
      headers: { cookie: "shuri_session=tok" },
    });
    expect(cookies.read(request)).toBe("tok");
  });

  it("prefers an explicit bearer token over the ambient cookie", () => {
    const request = new Request("http://localhost/", {
      headers: { cookie: "shuri_session=from-cookie", authorization: "Bearer explicit" },
    });
    expect(cookies.read(request)).toBe("explicit");
  });

  it("is undefined when the request carries neither", () => {
    expect(cookies.read(new Request("http://localhost/"))).toBeUndefined();
  });
});
