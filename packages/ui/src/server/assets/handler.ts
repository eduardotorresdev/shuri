import type { FallingHandler } from "@shuri/api";
import { weakEtag } from "./etag.js";
import type { AdminAsset, AdminAssets } from "./types.js";

/** The single-page app's entry document, served for every route the client router owns. */
const FALLBACK = "index.html";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE = "public, max-age=0, must-revalidate";

/**
 * Resolves a request path to the key an asset is stored under, or `undefined` when the path lies
 * outside the admin.
 *
 * Note what this cannot do: the result only ever reaches `Map.get`, so a `..` segment or an
 * absolute path finds nothing rather than escaping anywhere. That is the reason the bundle is held
 * as a map instead of being read from disk per request.
 * @param pathname - The request URL's pathname.
 * @param basePath - The path the admin is mounted at.
 * @returns The asset key, `""` for the admin's own root, or `undefined` when outside `basePath`.
 */
export function assetKey(pathname: string, basePath: string): string | undefined {
  if (pathname === basePath) return "";
  if (!pathname.startsWith(`${basePath}/`)) return undefined;
  return pathname.slice(basePath.length + 1).replace(/\/+$/, "");
}

/**
 * Answers with `asset`, honouring a matching `if-none-match`.
 * @param asset - The asset to serve.
 * @param request - The request being answered, read for `if-none-match`.
 * @param etag - The asset's entity tag.
 * @returns The response carrying `asset`, or a 304.
 */
function assetResponse(asset: AdminAsset, request: Request, etag: string): Response {
  const headers = {
    "content-type": asset.contentType,
    "cache-control": asset.immutable ? IMMUTABLE_CACHE : REVALIDATE_CACHE,
    etag,
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  // A fresh view per response: a `Response` takes ownership of the buffer it is given, and every
  // request for the same asset is served from the one array this map holds.
  return new Response(asset.body.slice(), { headers });
}

export interface CreateAdminAssetsHandlerOptions {
  /** The path the admin is mounted at. Must match the `base` the bundle was built with. */
  basePath: string;
}

/**
 * Serves the admin's built client bundle under `basePath`, and declines every other request.
 *
 * A request naming a file serves that file. A request naming anything else under `basePath` serves
 * `index.html`, because those paths belong to the client router, not to this handler: reloading
 * `/admin/collections/posts/abc` has to return the app, which then routes the URL itself. That is
 * what makes the fallback build (`adapter-static`'s `fallback` option) work over HTTP.
 *
 * `.json`, `.js` and friends are excluded from the fallback: a missing asset must 404 rather than
 * come back as HTML, which a browser would try to parse as a module and report as a syntax error
 * two layers away from the real cause.
 * @param assets - The bundle to serve, from `loadAdminAssets` or built by the host.
 * @param options - `basePath`, the path the admin is mounted at.
 * @returns A handler serving the admin, `undefined` for anything outside `basePath`.
 */
export function createAdminAssetsHandler(
  assets: AdminAssets,
  options: CreateAdminAssetsHandlerOptions,
): FallingHandler {
  const { basePath } = options;
  // The map never changes for the process's lifetime, so one tag per asset, hashed once at startup,
  // stays exact — no hashing of bodies per request.
  const etags = new Map([...assets].map(([key, asset]) => [key, weakEtag(asset.body)]));

  return async function handleRequest(request) {
    if (request.method !== "GET" && request.method !== "HEAD") return undefined;

    const key = assetKey(new URL(request.url).pathname, basePath);
    if (key === undefined) return undefined;

    const asset = assets.get(key);
    if (asset) return assetResponse(asset, request, etags.get(key) ?? "");

    if (key.includes(".")) return undefined;

    const fallback = assets.get(FALLBACK);
    if (!fallback) return undefined;
    return assetResponse(fallback, request, etags.get(FALLBACK) ?? "");
  };
}
