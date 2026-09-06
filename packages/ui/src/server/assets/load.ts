import { readdirSync, readFileSync } from "node:fs";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { contentTypeOf } from "./content-type.js";
import type { AdminAsset, AdminAssets } from "./types.js";

/** Files under this directory are named with a content hash by Vite, so they can be cached forever. */
const IMMUTABLE_PREFIX = "_app/immutable/";

/**
 * The `build/` directory of this package, where `vite build` writes the admin's client bundle.
 *
 * Resolved from this module's own URL rather than from `process.cwd()`: the handler is created by
 * the host app, whose working directory is its own, not this package's.
 * @returns The absolute path of this package's build output.
 */
export function defaultAssetsDir(): string {
  return fileURLToPath(new URL("../../../build", import.meta.url));
}

/**
 * Walks `dir`, reading every file into memory keyed by its path relative to `dir`.
 * @param dir - The directory to walk.
 * @param prefix - The path already walked, joined onto each entry's key.
 * @param into - The map each file is added to.
 */
function readInto(dir: string, prefix: string, into: Map<string, AdminAsset>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const key = prefix ? posix.join(prefix, entry.name) : entry.name;
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      readInto(path, key, into);
      continue;
    }
    into.set(key, {
      body: readFileSync(path),
      contentType: contentTypeOf(entry.name),
      immutable: key.startsWith(IMMUTABLE_PREFIX),
    });
  }
}

/**
 * Reads the admin's built client bundle off disk, once, into memory.
 *
 * Eager and synchronous on purpose. The bundle is a fixed set of small files that every request
 * afterwards is served from, so reading it at startup turns a per-request `stat`+`read` — and the
 * path-traversal question that comes with resolving a request path against a directory — into a map
 * lookup that cannot escape the map. It also fails at boot, where a missing build is obvious, rather
 * than as a 404 on somebody's first visit.
 *
 * This is the one place in the package that touches a filesystem; `createAdminHandler` takes the
 * result as data, so a runtime without `node:fs` can supply the same map from elsewhere.
 * @param [dir] - The directory to read. Defaults to this package's own `build/`.
 * @returns The bundle, keyed by path relative to `dir`.
 * @throws If `dir` doesn't exist — typically a package that hasn't been built yet.
 */
export function loadAdminAssets(dir: string = defaultAssetsDir()): AdminAssets {
  const assets = new Map<string, AdminAsset>();
  try {
    readInto(dir, "", assets);
  } catch (cause) {
    throw new Error(
      `Could not read the admin bundle at ${dir.split(sep).join("/")}. ` +
        "Run `pnpm --filter @shuri/ui build` first, or pass `assets` explicitly.",
      { cause },
    );
  }
  return assets;
}
