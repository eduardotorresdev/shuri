import { describe, expect, it } from "vitest";
import { assetKey, createAdminAssetsHandler } from "./handler.js";
import { weakEtag } from "./etag.js";
import type { AdminAsset, AdminAssets } from "./types.js";

const html = new TextEncoder().encode("<!doctype html><body>admin</body>");
const script = new TextEncoder().encode("export const x = 1;");

const asset = (
  body: Uint8Array,
  contentType: string,
  immutable: boolean,
): AdminAsset => ({
  body,
  contentType,
  immutable,
});

const assets: AdminAssets = new Map([
  ["index.html", asset(html, "text/html; charset=utf-8", false)],
  ["_app/immutable/entry/app.js", asset(script, "text/javascript; charset=utf-8", true)],
]);

const handler = createAdminAssetsHandler(assets, { basePath: "/admin" });

describe("assetKey", () => {
  it("resolves the admin's own root to the empty key", () => {
    expect(assetKey("/admin", "/admin")).toBe("");
  });

  it("strips the base path and any trailing slash", () => {
    expect(assetKey("/admin/favicon.svg", "/admin")).toBe("favicon.svg");
    expect(assetKey("/admin/collections/posts/", "/admin")).toBe("collections/posts");
  });

  it("declines a path outside the base, including one that merely starts with it", () => {
    expect(assetKey("/collections/posts", "/admin")).toBeUndefined();
    expect(assetKey("/administration", "/admin")).toBeUndefined();
  });
});

describe("createAdminAssetsHandler", () => {
  it("serves a file by path, with its own content type", async () => {
    const response = await handler(
      new Request("http://x/admin/_app/immutable/entry/app.js"),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await response?.text()).toBe("export const x = 1;");
  });

  it("caches a hashed file forever and revalidates everything else", async () => {
    const hashed = await handler(
      new Request("http://x/admin/_app/immutable/entry/app.js"),
    );
    const entry = await handler(new Request("http://x/admin"));

    expect(hashed?.headers.get("cache-control")).toContain("immutable");
    expect(entry?.headers.get("cache-control")).toContain("must-revalidate");
  });

  it("answers a client route with the app itself, so a deep link survives a reload", async () => {
    const response = await handler(
      new Request("http://x/admin/collections/posts/abc123"),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("404s a missing asset instead of answering it with HTML", async () => {
    expect(await handler(new Request("http://x/admin/_app/gone.js"))).toBeUndefined();
  });

  it("cannot be walked out of, because a path only ever reaches Map.get", async () => {
    expect(
      await handler(new Request("http://x/admin/../../etc/passwd.txt")),
    ).toBeUndefined();
  });

  it("declines anything outside the base path", async () => {
    expect(await handler(new Request("http://x/collections/posts"))).toBeUndefined();
  });

  it("declines a write, which belongs to the REST routes", async () => {
    expect(
      await handler(new Request("http://x/admin", { method: "POST" })),
    ).toBeUndefined();
  });

  it("answers 304 for an unchanged asset", async () => {
    const etag = weakEtag(script);
    const response = await handler(
      new Request("http://x/admin/_app/immutable/entry/app.js", {
        headers: { "if-none-match": etag },
      }),
    );

    expect(response?.status).toBe(304);
  });

  it("hands out a fresh body each time, so one response can't consume another's", async () => {
    const first = await handler(new Request("http://x/admin"));
    const second = await handler(new Request("http://x/admin"));

    expect(await first?.text()).toBe(await second?.text());
  });
});
