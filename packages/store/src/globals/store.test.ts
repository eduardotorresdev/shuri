import type { GlobalSchema } from "@shuri/core";
import { createCore } from "@shuri/core";
import { describe, expect, it, vi } from "vitest";
import { RecordValidationError } from "../errors.js";
import type { GlobalEvent } from "../events/types.js";
import { createStore } from "../store.js";
import { createFakeAdapter } from "../test-support.js";

const siteSettings: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [
    { type: "text", name: "name", required: true },
    { type: "number", name: "visits", kind: "integer", sign: "positive" },
  ],
};

const seoDefaults: GlobalSchema = {
  slug: "seo",
  title: "SEO defaults",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name", required: true }],
};

describe("GlobalStore", () => {
  it("returns an empty object before the first update", async () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    expect(await store.global("site").get()).toEqual({});
  });

  it("updates the global record, merging fields", async () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());

    await store.global("site").update({ name: "Acme" });
    expect(await store.global("site").get()).toEqual({ name: "Acme" });

    await store.global("site").update({ name: "Acme Co" });
    expect(await store.global("site").get()).toEqual({ name: "Acme Co" });
  });

  it("rejects an update that doesn't satisfy the global's fields, without touching the adapter", async () => {
    const adapter = createFakeAdapter();
    const spiedUpdate = vi.spyOn(adapter, "updateGlobal");
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, adapter);

    await expect(store.global("site").update({ visits: -1 })).rejects.toThrow(
      RecordValidationError,
    );
    expect(spiedUpdate).not.toHaveBeenCalled();
  });
});

describe("GlobalStore events", () => {
  it("emits an update carrying the merged record, before the update resolves", async () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    const events: GlobalEvent[] = [];
    store.global("site").subscribe((event) => events.push(event));

    await store.global("site").update({ name: "Acme" });
    await store.global("site").update({ visits: 2 });

    expect(events).toEqual([
      { scope: "global", type: "update", global: "site", record: { name: "Acme" } },
      {
        scope: "global",
        type: "update",
        global: "site",
        record: { name: "Acme", visits: 2 },
      },
    ]);
  });

  it("delivers only this global's events, and emits nothing for a rejected update", async () => {
    const core = createCore({
      collections: [],
      globals: [siteSettings, seoDefaults],
    });
    const store = createStore(core, createFakeAdapter());
    const events: GlobalEvent[] = [];
    store.global("site").subscribe((event) => events.push(event));

    await store.global("seo").update({ name: "Ignored" });
    await expect(store.global("site").update({ visits: -1 })).rejects.toThrow(
      RecordValidationError,
    );

    expect(events).toEqual([]);
  });
});
