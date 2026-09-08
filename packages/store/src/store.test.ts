import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { createCore } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { UnknownCollectionError } from "./collections/errors.js";
import { UnknownGlobalError } from "./globals/errors.js";
import { createStore } from "./store.js";
import { createFakeAdapter } from "./test-support.js";

const services: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [{ type: "text", name: "name", required: true }],
};

const siteSettings: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name", required: true }],
};

describe("Store.collection", () => {
  it("resolves a collection store per slug declared on the core", async () => {
    const core = createCore({ collections: [services] });
    const store = createStore(core, createFakeAdapter());

    const record = await store.collection("services").insert({ name: "Haircut" });
    expect(await store.collection("services").findOne(record.id)).toEqual(record);
  });

  it("returns the same collection store instance for repeated lookups", () => {
    const core = createCore({ collections: [services] });
    const store = createStore(core, createFakeAdapter());
    expect(store.collection("services")).toBe(store.collection("services"));
  });

  it("throws for an unknown collection slug", () => {
    const core = createCore({ collections: [services] });
    const store = createStore(core, createFakeAdapter());
    expect(() => store.collection("unknown" as never)).toThrow(UnknownCollectionError);
  });
});

describe("Store.global", () => {
  it("returns the same global store instance for repeated lookups", () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    expect(store.global("site")).toBe(store.global("site"));
  });

  it("throws for an unknown global slug", () => {
    const core = createCore({ collections: [], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    expect(() => store.global("unknown" as never)).toThrow(UnknownGlobalError);
  });
});

describe("Store.hooks", () => {
  it("is the single registry every collection and global of the store runs", async () => {
    const core = createCore({ collections: [services], globals: [siteSettings] });
    const store = createStore(core, createFakeAdapter());
    const seen: string[] = [];
    store.hooks.onCollection("*", "afterChange", ({ collection, operation, doc }) => {
      seen.push(`${collection}:${operation}:${doc.id}`);
    });
    store.hooks.onGlobal("*", "afterChange", ({ global, doc }) => {
      seen.push(`${global}:update:${String(doc.name)}`);
    });

    const record = await store.collection("services").insert({ name: "Haircut" });
    await store.global("site").update({ name: "Acme" });

    expect(seen).toEqual([`services:create:${record.id}`, "site:update:Acme"]);
  });
});
