/** One built file of the admin's client bundle, held in memory ready to be served. */
export interface AdminAsset {
  /** The file's bytes. `Uint8Array` rather than a string so images and fonts survive the round trip. */
  body: Uint8Array;
  contentType: string;
  /**
   * Whether the file may be cached forever. True for anything under the app directory, whose names
   * carry a content hash, false for the rest — `index.html` names those hashes, so caching it would
   * pin the browser to a deployment that no longer exists.
   */
  immutable: boolean;
}

/**
 * The admin's client bundle, keyed by root-relative path (`"index.html"`, `"_app/immutable/..."`).
 *
 * A plain map, and an argument rather than something the handler goes and finds, so the bundle can
 * come from somewhere other than a disk: `loadAdminAssets` reads it with `node:fs`, and a worker
 * deployment with no filesystem can build the same map from its own bindings.
 */
export type AdminAssets = ReadonlyMap<string, AdminAsset>;
