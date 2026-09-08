import type {
  CollectionHook,
  CollectionHookName,
  CollectionSchema,
  GlobalHook,
  GlobalHookName,
  GlobalSchema,
} from "@shuri/core";
import type { HookRegistry } from "./registry.js";

/**
 * Every hook to run for one collection operation: the ones the schema declares first, in
 * declaration order, then the ones registered programmatically (the slug's own, then `"*"`).
 * Resolved per call rather than once per bind, so a hook registered after the store was built
 * still runs on the next operation.
 * @param schema - The collection whose declared hooks come first.
 * @param registry - The registry holding the programmatic hooks.
 * @param name - The hook name to resolve.
 * @returns The hooks to run, in order.
 */
export function collectionHooksFor<N extends CollectionHookName>(
  schema: Pick<CollectionSchema, "slug" | "hooks">,
  registry: HookRegistry,
  name: N,
): CollectionHook<N>[] {
  return [
    ...((schema.hooks?.[name] ?? []) as CollectionHook<N>[]),
    ...registry.collectionHooks(schema.slug, name),
  ];
}

/**
 * The global counterpart of `collectionHooksFor`, same order.
 * @param schema - The global whose declared hooks come first.
 * @param registry - The registry holding the programmatic hooks.
 * @param name - The hook name to resolve.
 * @returns The hooks to run, in order.
 */
export function globalHooksFor<N extends GlobalHookName>(
  schema: Pick<GlobalSchema, "slug" | "hooks">,
  registry: HookRegistry,
  name: N,
): GlobalHook<N>[] {
  return [
    ...((schema.hooks?.[name] ?? []) as GlobalHook<N>[]),
    ...registry.globalHooks(schema.slug, name),
  ];
}
