import type {
  CollectionHook,
  CollectionHookName,
  GlobalHook,
  GlobalHookName,
} from "@shuri/core";

/** Removes a hook registered through `HookRegistry`. */
export type Unsubscribe = () => void;

/** The slug a hook is registered for, or `"*"` to run for every collection/global. */
export type HookTarget = string | "*";

/**
 * Programmatic hook registration, PocketBase style, next to the hooks a schema declares: the store
 * runs both, schema-declared first. `"*"` registers a cross-cutting hook (an SSE feed, an audit
 * log) that runs for every slug, after that slug's own hooks.
 */
export interface HookRegistry {
  onCollection<N extends CollectionHookName>(
    slug: HookTarget,
    name: N,
    hook: CollectionHook<N>,
  ): Unsubscribe;
  onGlobal<N extends GlobalHookName>(
    slug: HookTarget,
    name: N,
    hook: GlobalHook<N>,
  ): Unsubscribe;
  /** The registered hooks for `slug`/`name`: the slug's own first, then the `"*"` ones, each in registration order. */
  collectionHooks<N extends CollectionHookName>(
    slug: string,
    name: N,
  ): CollectionHook<N>[];
  /** The registered hooks for `slug`/`name`: the slug's own first, then the `"*"` ones, each in registration order. */
  globalHooks<N extends GlobalHookName>(slug: string, name: N): GlobalHook<N>[];
}

type AnyHook = (args: never) => unknown;

type HookKind = "collection" | "global";

const keyOf = (kind: HookKind, slug: string, name: string) => `${kind}\0${slug}\0${name}`;

/**
 * Creates an empty registry. Lookups snapshot the registered hooks into a new array, so a hook
 * that unsubscribes (itself or another) while a chain is running can't make the runner skip one.
 * @returns A `HookRegistry` backed by in-memory sets keyed by kind, slug and hook name.
 */
export function createHookRegistry(): HookRegistry {
  const hooks = new Map<string, Set<AnyHook>>();

  function register(key: string, hook: AnyHook): Unsubscribe {
    let set = hooks.get(key);
    if (!set) {
      set = new Set();
      hooks.set(key, set);
    }
    set.add(hook);
    return () => {
      set.delete(hook);
    };
  }

  function lookup(kind: HookKind, slug: string, name: string): AnyHook[] {
    return [
      ...(hooks.get(keyOf(kind, slug, name)) ?? []),
      ...(slug === "*" ? [] : (hooks.get(keyOf(kind, "*", name)) ?? [])),
    ];
  }

  return {
    onCollection: (slug, name, hook) => register(keyOf("collection", slug, name), hook),
    onGlobal: (slug, name, hook) => register(keyOf("global", slug, name), hook),
    collectionHooks: (slug, name) => lookup("collection", slug, name) as never,
    globalHooks: (slug, name) => lookup("global", slug, name) as never,
  };
}
