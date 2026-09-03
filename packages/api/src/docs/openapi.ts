import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { collectionSchema, globalSchema, type JsonSchema } from "./json-schema.js";
import { collectionPaths, globalPaths } from "./paths.js";

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
  title?: string;
  version?: string;
}

/**
 * Builds an OpenAPI 3.1 document describing the REST surface `createApiHandler`/`createGlobalsApiHandler`
 * serve: one path pair (list/create, get/update/delete) per collection and one path pair (get/update)
 * per global, mirroring `handler.ts`'/`globals-handler.ts`'s routes exactly, plus a
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
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, JsonSchema> = {};

  for (const collection of collections) {
    Object.assign(paths, collectionPaths(collection, basePath));
    schemas[collection.slug] = collectionSchema(collection);
  }

  for (const global of globals) {
    Object.assign(paths, globalPaths(global, globalsBasePath));
    schemas[global.slug] = globalSchema(global);
  }

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
