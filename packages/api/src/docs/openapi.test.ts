import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi.js";

const servicesSchema: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [
    { type: "text", name: "name", required: true, minLength: 2 },
    { type: "email", name: "contactEmail" },
    { type: "number", name: "price", kind: "float", sign: "positive" },
    { type: "boolean", name: "active" },
    {
      type: "select",
      name: "category",
      options: [
        { label: "Hair", value: "hair" },
        { label: "Nails", value: "nails" },
      ],
    },
    {
      type: "relation",
      name: "provider",
      collection: "providers",
      multiple: true,
    },
  ],
};

describe("buildOpenApiDocument", () => {
  it("declares basic document metadata", () => {
    const document = buildOpenApiDocument([servicesSchema], [], {
      title: "Salon API",
      version: "1.2.3",
    });

    expect(document.openapi).toBe("3.1.0");
    expect(document.info).toEqual({ title: "Salon API", version: "1.2.3" });
  });

  it("emits list/create and get/update/delete paths per collection, under basePath", () => {
    const document = buildOpenApiDocument([servicesSchema], [], {
      basePath: "/api",
      realtime: false,
    });

    expect(Object.keys(document.paths)).toEqual(["/api/services", "/api/services/{id}"]);
    expect(Object.keys(document.paths["/api/services"] ?? {})).toEqual(["get", "post"]);
    expect(Object.keys(document.paths["/api/services/{id}"] ?? {})).toEqual([
      "get",
      "patch",
      "delete",
    ]);
  });

  it("derives a components schema per collection from its fields", () => {
    const document = buildOpenApiDocument([servicesSchema]);
    const schema = document.components.schemas["services"];
    const properties = schema?.properties;

    expect(properties?.["name"]).toEqual({ type: "string", minLength: 2 });
    expect(properties?.["contactEmail"]).toEqual({
      type: "string",
      format: "email",
    });
    expect(properties?.["price"]).toEqual({ type: "number", minimum: 0 });
    expect(properties?.["active"]).toEqual({ type: "boolean" });
    expect(properties?.["category"]).toEqual({
      type: "string",
      enum: ["hair", "nails"],
    });
    expect(properties?.["provider"]).toEqual({
      type: "array",
      items: { type: "string" },
    });
    // Read-only: the store generates the id and rejects a payload carrying one.
    expect(properties?.["id"]).toEqual({ type: "string", readOnly: true });
    expect(schema?.required).toEqual(["name"]);
  });

  it("defaults basePath to /collections", () => {
    const document = buildOpenApiDocument([servicesSchema]);
    expect(document.paths["/collections/services"]).toBeDefined();
  });

  describe("globals", () => {
    const siteSettings: GlobalSchema = {
      slug: "site",
      title: "Site settings",
      category: { title: "Geral" },
      fields: [{ type: "text", name: "name", required: true, minLength: 2 }],
    };

    it("emits only get/update paths per global, under globalsBasePath", () => {
      const document = buildOpenApiDocument([], [siteSettings], {
        globalsBasePath: "/api-globals",
        realtime: false,
      });

      expect(Object.keys(document.paths)).toEqual(["/api-globals/site"]);
      expect(Object.keys(document.paths["/api-globals/site"] ?? {})).toEqual([
        "get",
        "patch",
      ]);
    });

    it("defaults globalsBasePath to /globals", () => {
      const document = buildOpenApiDocument([], [siteSettings]);
      expect(document.paths["/globals/site"]).toBeDefined();
    });

    it("tags global paths with the global's category title, not its own title", () => {
      const document = buildOpenApiDocument([], [siteSettings]);
      const getOperation = document.paths["/globals/site"]?.["get"] as {
        tags: string[];
      };
      expect(getOperation.tags).toEqual(["Geral"]);
    });

    it("derives a components schema per global from its fields, without an id property", () => {
      const document = buildOpenApiDocument([], [siteSettings]);
      const schema = document.components.schemas["site"];

      expect(schema?.properties).toEqual({
        name: { type: "string", minLength: 2 },
      });
      expect(schema?.properties?.["id"]).toBeUndefined();
      expect(schema?.required).toEqual(["name"]);
    });
  });
});

describe("buildOpenApiDocument with the event stream", () => {
  it("describes the event stream at the default path", () => {
    const document = buildOpenApiDocument([servicesSchema]);
    const stream = document.paths["/events"]?.["get"] as {
      responses: Record<string, { content: Record<string, unknown> }>;
      parameters: { name: string }[];
    };

    expect(stream.responses["200"]?.content).toHaveProperty("text/event-stream");
    expect(stream.parameters.map((parameter) => parameter.name)).toEqual([
      "collection",
      "global",
      "id",
      "events",
    ]);
  });

  it("honors a custom realtime base path", () => {
    const document = buildOpenApiDocument([servicesSchema], [], {
      realtimeBasePath: "/stream",
    });

    expect(document.paths["/stream"]).toBeDefined();
    expect(document.paths["/events"]).toBeUndefined();
  });

  it("omits the event stream when realtime is disabled", () => {
    const document = buildOpenApiDocument([servicesSchema], [], { realtime: false });
    expect(document.paths["/events"]).toBeUndefined();
  });
});
