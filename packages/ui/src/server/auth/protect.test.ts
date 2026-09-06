import { describe, expect, it } from "vitest";
import { everythingUnderApi, writesToApi } from "./protect.js";

const api = { collections: "/collections", globals: "/globals", events: "/events" };

const request = (method: string, path: string): Request =>
  new Request(`http://x${path}`, { method });

describe("writesToApi", () => {
  const protect = writesToApi(api);

  it("matches every write to the collections and globals routes", () => {
    expect(protect(request("POST", "/collections/posts"))).toBe(true);
    expect(protect(request("PATCH", "/collections/posts/1"))).toBe(true);
    expect(protect(request("DELETE", "/collections/posts/1"))).toBe(true);
    expect(protect(request("PATCH", "/globals/site"))).toBe(true);
  });

  it("leaves reads open, which is what a headless API is for", () => {
    expect(protect(request("GET", "/collections/posts"))).toBe(false);
    expect(protect(request("HEAD", "/globals/site"))).toBe(false);
  });

  it("leaves the auth routes alone, or signing in would need a session", () => {
    expect(protect(request("POST", "/auth/login"))).toBe(false);
  });

  it("leaves the admin's own paths alone, so the login screen can be reached", () => {
    expect(protect(request("GET", "/admin"))).toBe(false);
    expect(protect(request("GET", "/admin/schema.json"))).toBe(false);
  });

  it("does not match a path that merely starts like a base path", () => {
    expect(protect(request("POST", "/collectionsx"))).toBe(false);
  });

  it("follows relocated base paths", () => {
    const moved = writesToApi({ ...api, collections: "/api/collections" });

    expect(moved(request("POST", "/api/collections/posts"))).toBe(true);
    expect(moved(request("POST", "/collections/posts"))).toBe(false);
  });
});

describe("everythingUnderApi", () => {
  const protect = everythingUnderApi(api);

  it("matches reads as well as writes", () => {
    expect(protect(request("GET", "/collections/posts"))).toBe(true);
    expect(protect(request("POST", "/collections/posts"))).toBe(true);
  });

  it("still leaves everything outside the REST routes alone", () => {
    expect(protect(request("GET", "/admin"))).toBe(false);
    expect(protect(request("POST", "/auth/login"))).toBe(false);
  });
});
