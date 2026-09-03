import { describe, expect, it } from "vitest";
import { matchCollectionRoute } from "./routes.js";

describe("matchCollectionRoute", () => {
  it("matches a collection-only path", () => {
    expect(matchCollectionRoute("/collections/services", "/collections")).toEqual({ slug: "services" });
  });

  it("matches a collection path with a record id", () => {
    expect(matchCollectionRoute("/collections/services/abc", "/collections")).toEqual({
      slug: "services",
      id: "abc",
    });
  });

  it("ignores a trailing slash", () => {
    expect(matchCollectionRoute("/collections/services/", "/collections")).toEqual({ slug: "services" });
  });

  it("returns undefined outside basePath", () => {
    expect(matchCollectionRoute("/other/services", "/collections")).toBeUndefined();
  });

  it("returns undefined for basePath with no slug", () => {
    expect(matchCollectionRoute("/collections", "/collections")).toBeUndefined();
    expect(matchCollectionRoute("/collections/", "/collections")).toBeUndefined();
  });

  it("returns undefined for extra path segments", () => {
    expect(matchCollectionRoute("/collections/services/abc/extra", "/collections")).toBeUndefined();
  });

  it("respects a custom basePath", () => {
    expect(matchCollectionRoute("/api/services", "/api")).toEqual({ slug: "services" });
  });
});
