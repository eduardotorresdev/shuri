import { servableCollections, type CollectionSchema, type GlobalSchema } from "@shuri/core";
import { collectionSchema, globalSchema, type JsonSchema } from "./json-schema.js";
import { collectionPaths } from "./paths/collections.js";
import { globalPaths } from "./paths/globals.js";
import { realtimePaths } from "./paths/realtime.js";

export type { JsonSchema } from "./json-schema.js";

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema> };
}

export interface BuildOpenApiDocumentOptions {
  /** Path prefix collection routes are mounted under. Must match `createApiHandler`'s. Defaults to "/collections". */
  basePath?: string;
  /** Path prefix global routes are mounted under. Must match `createGlobalsApiHandler`'s. Defaults to "/globals". */
  globalsBasePath?: string;
  /** Path the event stream is mounted at. Must match `createRealtimeHandler`'s. Defaults to "/events". */
  realtimeBasePath?: string;
  /** Whether to describe the event stream. Defaults to `true`. */
  realtime?: boolean;
  title?: string;
  version?: string;
}

/**
 * Builds an OpenAPI 3.1 document describing the REST surface `createApiHandler`/`createGlobalsApiHandler`
 * serve: one path pair (list/create, get/update/delete) per collection and one path pair (get/update)
 * per global, plus the event stream `createRealtimeHandler` serves, mirroring those routes exactly,
 * plus a
 * `components.schemas` entry per collection/global derived from its fields (see `fieldSchema`). Pure
 * and framework-agnostic, so it can be tested without HTTP.
 * @param collections - The collections to describe.
 * @param [globals] - The globals to describe.
 * @param [options] - Options controlling the document, e.g. `basePath`/`globalsBasePath`.
 * @returns The OpenAPI 3.1 document describing `collections` and `globals`.
 */
export function buildOpenApiDocument(
  collections: readonly CollectionSchema[],
  globals: readonly GlobalSchema[] = [],
  options: BuildOpenApiDocumentOptions = {},
): OpenApiDocument {
  const basePath = options.basePath ?? "/collections";
  const globalsBasePath = options.globalsBasePath ?? "/globals";
  const realtimeBasePath = options.realtimeBasePath ?? "/events";
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, JsonSchema> = {};

  // Collections declared `internal` aren't served, so describing them would promise routes that
  // 404. Filtering here drops their paths and their `components.schemas` entry together, leaving no
  // dangling `$ref` behind.
  for (const collection of servableCollections(collections)) {
    Object.assign(paths, collectionPaths(collection, basePath));
    schemas[collection.slug] = collectionSchema(collection);
  }

  for (const global of globals) {
    Object.assign(paths, globalPaths(global, globalsBasePath));
    schemas[global.slug] = globalSchema(global);
  }

  // The event union is deliberately kept out of `components.schemas`: its keys are raw user slugs
  // (`schemas[collection.slug]`), so any name added there could collide with one of them.
  if (options.realtime !== false) Object.assign(paths, realtimePaths(realtimeBasePath));

  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? "Shuri API",
      version: options.version ?? "0.0.0",
    },
    paths,
    components: { schemas },
  };
}
