import { describe, expect, it, vi } from "vitest";
import { createHookRegistry } from "./registry.js";

describe("createHookRegistry", () => {
  it("returns a slug's hooks in registration order, then the wildcard ones", () => {
    const registry = createHookRegistry();
    const first = vi.fn();
    const second = vi.fn();
    const every = vi.fn();
    registry.onCollection("*", "afterChange", every);
    registry.onCollection("posts", "afterChange", first);
    registry.onCollection("posts", "afterChange", second);

    expect(registry.collectionHooks("posts", "afterChange")).toEqual([
      first,
      second,
      every,
    ]);
  });

  it("keeps slugs, names and kinds apart", () => {
    const registry = createHookRegistry();
    const collectionHook = vi.fn();
    const globalHook = vi.fn();
    registry.onCollection("posts", "afterChange", collectionHook);
    registry.onGlobal("posts", "afterChange", globalHook);

    expect(registry.collectionHooks("posts", "afterChange")).toEqual([collectionHook]);
    expect(registry.collectionHooks("posts", "beforeChange")).toEqual([]);
    expect(registry.collectionHooks("authors", "afterChange")).toEqual([]);
    expect(registry.globalHooks("posts", "afterChange")).toEqual([globalHook]);
  });

  it("stops returning a hook once unsubscribed, and registers a function once", () => {
    const registry = createHookRegistry();
    const hook = vi.fn();
    const unsubscribe = registry.onGlobal("site", "afterRead", hook);
    registry.onGlobal("site", "afterRead", hook);

    expect(registry.globalHooks("site", "afterRead")).toEqual([hook]);
    unsubscribe();
    expect(registry.globalHooks("site", "afterRead")).toEqual([]);
  });

  it("hands out a snapshot, so unsubscribing mid-iteration can't skip a hook", () => {
    const registry = createHookRegistry();
    const seen: string[] = [];
    const unsubscribeFirst = registry.onCollection("posts", "afterDelete", () => {
      seen.push("first");
      unsubscribeFirst();
    });
    registry.onCollection("posts", "afterDelete", () => {
      seen.push("second");
    });

    for (const hook of registry.collectionHooks("posts", "afterDelete")) {
      hook({ collection: "posts", context: {}, id: "1" });
    }

    expect(seen).toEqual(["first", "second"]);
    expect(registry.collectionHooks("posts", "afterDelete")).toHaveLength(1);
  });
});
