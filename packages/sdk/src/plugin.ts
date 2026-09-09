import type { FallingHandler } from "@shuri/api";
import type { AuthApi } from "@shuri/auth";
import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { Store } from "@shuri/store";

/**
 * What a plugin receives once `create()` has built everything: the store its collections live in,
 * and the auth service if `config.auth` declared one.
 *
 * The store is handed to plugins but stays off `ShuriApp`, which deliberately stopped exposing it.
 * The difference is who is holding it: a plugin is part of the composition and needs the store to do
 * its job, while an app's consumer has `app.collections` and should not be reaching past it.
 */
export interface PluginContext<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> {
  store: Store<T, G>;
  auth: AuthApi | undefined;
}

/**
 * A unit of functionality that contributes **collections** to an app's schema and **handlers** to its
 * HTTP surface, mounted through `create({ plugins })`.
 *
 * This exists for the case `handlers` cannot serve: something whose persistence lives in the app's
 * own store. Its collections must be in the schema before the store is built, and its handlers need
 * that store once it is — a circle that only `create()` can close, since it is what builds both.
 * `@shuri/better-auth` is exactly that shape.
 *
 * Its collections are merged into the app's schema but kept **off `app.collections`**, for the same
 * reason auth's are: `app.collections.session.insert(...)` would walk straight past every invariant
 * the plugin owning that table maintains.
 */
export interface ShuriPlugin<
  T extends readonly CollectionSchema[] = CollectionSchema[],
  G extends readonly GlobalSchema[] = GlobalSchema[],
> {
  /** Identifies the plugin in error messages, e.g. a slug collision. */
  name: string;
  /** Collections merged into the app's schema before the store is built. */
  collections?: readonly CollectionSchema[];
  /** Handlers mounted ahead of the built-in routes, resolved once the store exists. */
  handlers?: (context: PluginContext<T, G>) => readonly FallingHandler[];
}

/** Two plugins, or a plugin and the app, declaring the same collection slug. */
export class PluginSlugCollisionError extends Error {
  constructor(
    public readonly slug: string,
    public readonly plugin: string,
  ) {
    super(
      `Plugin "${plugin}" declares collection "${slug}", which is already declared. ` +
        "Rename it, or configure the plugin to use a different table name.",
    );
    this.name = "PluginSlugCollisionError";
  }
}

/**
 * Collects every plugin's collections, failing on the first slug already taken.
 *
 * Checked here rather than left to `createCore`'s duplicate-slug issue, so the message names the
 * plugin that brought the collision — which is the one thing the host needs in order to fix it.
 * @param plugins - The declared plugins.
 * @param taken - Slugs already claimed, by the app's own collections and by auth's.
 * @returns Every plugin collection, in plugin order.
 * @throws PluginSlugCollisionError on the first slug already claimed.
 */
export function collectPluginCollections(
  plugins: readonly ShuriPlugin[],
  taken: ReadonlySet<string>,
): readonly CollectionSchema[] {
  const claimed = new Set(taken);
  const collections: CollectionSchema[] = [];

  for (const plugin of plugins) {
    for (const collection of plugin.collections ?? []) {
      if (claimed.has(collection.slug)) {
        throw new PluginSlugCollisionError(collection.slug, plugin.name);
      }
      claimed.add(collection.slug);
      collections.push(collection);
    }
  }
  return collections;
}
