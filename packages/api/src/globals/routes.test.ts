import { describe, expect, it } from "vitest";
import { matchGlobalRoute } from "./routes.js";

describe("matchGlobalRoute", () => {
  it("matches a global path", () => {
    expect(matchGlobalRoute("/globals/site", "/globals")).toEqual({
      slug: "site",
    });
  });

  it("ignores a trailing slash", () => {
    expect(matchGlobalRoute("/globals/site/", "/globals")).toEqual({
      slug: "site",
    });
  });

  it("returns undefined outside basePath", () => {
    expect(matchGlobalRoute("/other/site", "/globals")).toBeUndefined();
  });

  it("returns undefined for basePath with no slug", () => {
    expect(matchGlobalRoute("/globals", "/globals")).toBeUndefined();
    expect(matchGlobalRoute("/globals/", "/globals")).toBeUndefined();
  });

  it("returns undefined for extra path segments", () => {
    expect(matchGlobalRoute("/globals/site/extra", "/globals")).toBeUndefined();
  });

  it("respects a custom basePath", () => {
    expect(matchGlobalRoute("/api-globals/site", "/api-globals")).toEqual({
      slug: "site",
    });
  });
});
