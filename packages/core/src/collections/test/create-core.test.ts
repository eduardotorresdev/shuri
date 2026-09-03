import { describe, expect, it } from "vitest";
import { GlobalSchemaError } from "../../globals/errors.js";
import type { GlobalSchema } from "../../globals/types.js";
import { createCore } from "../define.js";
import { CollectionSchemaError } from "../errors.js";
import type { CollectionSchema } from "../types.js";

const categories: CollectionSchema = {
  slug: "categories",
  title: "Categories",
  singular: "Category",
  plural: "Categories",
  fields: [{ type: "text", name: "name", required: true }],
};

const services: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  orderable: true,
  fields: [
    { type: "text", name: "name", required: true, maxLength: 120 },
    { type: "textarea", name: "description" },
    { type: "email", name: "contactEmail", required: true },
    {
      type: "select",
      name: "status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
    },
    { type: "number", name: "price", kind: "float", sign: "positive", min: 0 },
    {
      type: "number",
      name: "capacity",
      kind: "integer",
      sign: "positive",
      min: 1,
      max: 100,
    },
    { type: "boolean", name: "featured" },
    { type: "relation", name: "category", collection: "categories" },
  ],
};

describe("createCore with a realistic collections schema", () => {
  it("builds a core exposing every declared collection", () => {
    const core = createCore({ collections: [categories, services] });

    expect(core.collections).toHaveLength(2);
    expect(core.getCollection("services")).toBe(services);
    expect(core.getCollection("categories")).toBe(categories);
  });

  it("preserves the orderable flag distinguishing reorderable lists", () => {
    const core = createCore({ collections: [categories, services] });

    expect(core.getCollection("services")?.orderable).toBe(true);
    expect(core.getCollection("categories")?.orderable).toBeUndefined();
  });

  it("resolves relation fields against sibling collections", () => {
    const core = createCore({ collections: [categories, services] });

    const relationField = core
      .getCollection("services")
      ?.fields.find((field) => field.type === "relation");

    expect(relationField).toMatchObject({
      type: "relation",
      collection: "categories",
    });
    expect(core.getCollection((relationField as { collection: string }).collection)).toBe(
      categories,
    );
  });

  it("returns undefined for an unknown slug", () => {
    const core = createCore({ collections: [categories] });
    expect(core.getCollection("unknown")).toBeUndefined();
  });

  it("rejects the whole schema when a relation points to a missing collection", () => {
    const brokenServices: CollectionSchema = {
      ...services,
      fields: [
        ...services.fields,
        { type: "relation", name: "author", collection: "authors" },
      ],
    };

    expect(() => createCore({ collections: [brokenServices] })).toThrow(
      CollectionSchemaError,
    );
  });
});

const siteSettings: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name", required: true }],
};

describe("createCore with globals", () => {
  it("builds a core exposing every declared global", () => {
    const core = createCore({
      collections: [categories],
      globals: [siteSettings],
    });

    expect(core.globals).toHaveLength(1);
    expect(core.getGlobal("site")).toBe(siteSettings);
  });

  it("defaults globals to an empty array when omitted", () => {
    const core = createCore({ collections: [categories] });
    expect(core.globals).toEqual([]);
  });

  it("returns undefined for an unknown global slug", () => {
    const core = createCore({
      collections: [categories],
      globals: [siteSettings],
    });
    expect(core.getGlobal("unknown")).toBeUndefined();
  });

  it("resolves a global's relation field against a declared collection", () => {
    const globalWithRelation: GlobalSchema = {
      ...siteSettings,
      fields: [
        ...siteSettings.fields,
        { type: "relation", name: "featured", collection: "categories" },
      ],
    };

    const core = createCore({
      collections: [categories],
      globals: [globalWithRelation],
    });
    expect(core.getGlobal("site")).toBe(globalWithRelation);
  });

  it("rejects the whole schema when a global's relation points to a missing collection", () => {
    const brokenGlobal: GlobalSchema = {
      ...siteSettings,
      fields: [
        ...siteSettings.fields,
        { type: "relation", name: "author", collection: "authors" },
      ],
    };

    expect(() =>
      createCore({ collections: [categories], globals: [brokenGlobal] }),
    ).toThrow(GlobalSchemaError);
  });
});
