import { createHookRegistry } from "@shuri/store";
import { describe, expect, it, vi } from "vitest";
import type { StoreEvent } from "./event.js";
import { subscribeToChanges } from "./source.js";

const context = {};

describe("subscribeToChanges", () => {
  it("maps the after hooks of every slug to one event each", async () => {
    const hooks = createHookRegistry();
    const events: StoreEvent[] = [];
    subscribeToChanges(hooks, (event) => events.push(event));

    for (const hook of hooks.collectionHooks("services", "afterChange")) {
      await hook({
        collection: "services",
        context,
        operation: "create",
        doc: { id: "1", name: "Haircut" },
      });
      await hook({
        collection: "services",
        context,
        operation: "update",
        doc: { id: "1", name: "Trim" },
        previousDoc: { id: "1", name: "Haircut" },
      });
    }
    for (const hook of hooks.collectionHooks("services", "afterDelete")) {
      await hook({
        collection: "services",
        context,
        id: "1",
        doc: { id: "1", name: "Trim" },
      });
    }
    for (const hook of hooks.globalHooks("site", "afterChange")) {
      await hook({ global: "site", context, doc: { name: "Acme" }, previousDoc: {} });
    }

    expect(events).toEqual([
      {
        scope: "collection",
        type: "create",
        collection: "services",
        id: "1",
        record: { id: "1", name: "Haircut" },
      },
      {
        scope: "collection",
        type: "update",
        collection: "services",
        id: "1",
        record: { id: "1", name: "Trim" },
      },
      { scope: "collection", type: "delete", collection: "services", id: "1" },
      { scope: "global", type: "update", global: "site", record: { name: "Acme" } },
    ]);
  });

  it("unregisters every hook at once", () => {
    const hooks = createHookRegistry();
    const unsubscribe = subscribeToChanges(hooks, () => {});

    expect(hooks.collectionHooks("any", "afterChange")).toHaveLength(1);
    expect(hooks.collectionHooks("any", "afterDelete")).toHaveLength(1);
    expect(hooks.globalHooks("any", "afterChange")).toHaveLength(1);
    unsubscribe();
    expect(hooks.collectionHooks("any", "afterChange")).toHaveLength(0);
    expect(hooks.collectionHooks("any", "afterDelete")).toHaveLength(0);
    expect(hooks.globalHooks("any", "afterChange")).toHaveLength(0);
  });

  it("never lets a throwing listener fail the write, rethrowing out of band instead", async () => {
    const hooks = createHookRegistry();
    subscribeToChanges(hooks, () => {
      throw new Error("stream broke");
    });
    const [hook] = hooks.collectionHooks("services", "afterDelete");
    const onUnhandled = vi.fn();
    process.once("uncaughtException", onUnhandled);

    expect(() => hook({ collection: "services", context, id: "1" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off("uncaughtException", onUnhandled);
    expect(onUnhandled).toHaveBeenCalledWith(
      expect.objectContaining({ message: "stream broke" }),
      expect.anything(),
    );
  });
});
