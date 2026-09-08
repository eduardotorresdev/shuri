import type { GlobalSchema } from "@shuri/core";
import { createCore } from "@shuri/core";
import { describe, expect, it, vi } from "vitest";
import { RecordValidationError } from "../errors.js";
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
  it("exposes the schema it was bound to", () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    expect(store.global("site").schema).toBe(siteSettings);
  });

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

describe("GlobalStore hooks", () => {
  it("runs schema-declared hooks before registered ones, with the pre-image and the merged record", async () => {
    const seen: unknown[] = [];
    const siteWithHooks: GlobalSchema = {
      ...siteSettings,
      hooks: {
        beforeChange: [
          ({ data, originalDoc }) => {
            seen.push(["schema:before", data, originalDoc]);
            return { ...data, visits: 1 };
          },
        ],
      },
    };
    const core = createCore({ collections: [], globals: [siteWithHooks] });
    const store = createStore(core, createFakeAdapter());
    store.hooks.onGlobal("site", "afterChange", ({ doc, previousDoc }) => {
      seen.push(["registered:after", doc, previousDoc]);
    });

    await store.global("site").update({ name: "Acme" });
    await store.global("site").update({ name: "Acme Co" });

    expect(seen).toEqual([
      ["schema:before", { name: "Acme" }, {}],
      ["registered:after", { name: "Acme", visits: 1 }, {}],
      ["schema:before", { name: "Acme Co" }, { name: "Acme", visits: 1 }],
      ["registered:after", { name: "Acme Co", visits: 1 }, { name: "Acme", visits: 1 }],
    ]);
  });

  it("runs beforeRead and afterRead around get, letting afterRead replace the record", async () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    const reads: string[] = [];
    store.hooks.onGlobal("site", "beforeRead", ({ global }) => {
      reads.push(global);
    });
    store.hooks.onGlobal("*", "afterRead", ({ doc }) => ({ ...doc, computed: true }));

    expect(await store.global("site").get()).toEqual({ computed: true });
    expect(reads).toEqual(["site"]);
  });

  it("runs a hook only for its own global, and no after hook for a rejected update", async () => {
    const core = createCore({
      collections: [],
      globals: [siteSettings, seoDefaults],
    });
    const store = createStore(core, createFakeAdapter());
    const afterChange = vi.fn();
    store.hooks.onGlobal("site", "afterChange", afterChange);

    await store.global("seo").update({ name: "Ignored" });
    await expect(store.global("site").update({ visits: -1 })).rejects.toThrow(
      RecordValidationError,
    );

    expect(afterChange).not.toHaveBeenCalled();
  });
});
