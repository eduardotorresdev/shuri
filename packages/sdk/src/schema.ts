import {
  createCore,
  type Core,
  type CollectionSchema,
  type GlobalSchema,
  type ResolvedSchema,
} from "@shuri/core";
import { collectPluginCollections, type ShuriPlugin } from "./plugin.js";

/** The part of the app config that decides the schema: what the plugins add and what is declared. */
export interface SchemaConfig<
  T extends readonly CollectionSchema[],
  G extends readonly GlobalSchema[],
> {
  collections: T;
  globals?: G;
  plugins?: readonly ShuriPlugin[];
}

/**
 * Merges every plugin's collections in ahead of the declared ones and validates the whole schema.
 * `create()` builds its `Core` from this, so the schema is validated once and `resolveSchema`
 * (used by tools outside the app, such as `@shuri/migrate`) sees exactly what `create()` sees.
 * @param config - The declared collections/globals and the plugins.
 * @returns The validated `Core`, whose `collections` include the plugins'.
 * @throws PluginSlugCollisionError when a plugin claims a slug already taken.
 * @throws CollectionSchemaError | GlobalSchemaError when the merged schema is invalid.
 */
export function resolveCore<
  const T extends readonly CollectionSchema[],
  const G extends readonly GlobalSchema[] = [],
>(config: SchemaConfig<T, G>): Core<T, G> {
  const pluginCollections = collectPluginCollections(
    config.plugins ?? [],
    new Set(config.collections.map((collection) => collection.slug)),
  );
  const collections = [...pluginCollections, ...config.collections] as unknown as T;
  return createCore({ collections, globals: (config.globals ?? []) as G });
}

/**
 * The full, validated schema of an app: its collections and globals plus every plugin's. The input
 * of `@shuri/migrate`, which must diff the schema the store really runs on.
 * @param config - The declared collections/globals and the plugins (an app config works as is).
 * @returns Every collection (plugins' first) and global.
 * @throws PluginSlugCollisionError when a plugin claims a slug already taken.
 * @throws CollectionSchemaError | GlobalSchemaError when the merged schema is invalid.
 */
export function resolveSchema(
  config: SchemaConfig<readonly CollectionSchema[], readonly GlobalSchema[]>,
): ResolvedSchema {
  const { collections, globals } = resolveCore(config);
  return { collections, globals };
}
