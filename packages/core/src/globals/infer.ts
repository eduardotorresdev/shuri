import type { InferFields } from "../collections/infer.js";
import type { GlobalSchema } from "./types.js";

/** Maps a single `GlobalSchema` to the plain object shape of its record. */
export type InferGlobal<G extends GlobalSchema> = InferFields<G["fields"]>;

/** Maps an array of globals, as returned by `defineGlobals`/`createCore`, to a `slug -> record shape` map. */
export type InferGlobals<T extends readonly GlobalSchema[]> = {
  [G in T[number] as G["slug"]]: InferGlobal<G>;
};
