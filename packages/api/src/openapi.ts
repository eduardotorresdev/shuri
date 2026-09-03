import type { CollectionSchema, Field } from "@shuri/core";

/** Minimal JSON Schema subset this module emits — enough for OpenAPI 3.1's `components.schemas`. */
export interface JsonSchema {
  type?: string;
  format?: string;
  enum?: readonly string[];
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  title?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema> };
}

export interface BuildOpenApiDocumentOptions {
  /** Path prefix collection routes are mounted under. Must match `createApiHandler`'s. Defaults to "/collections". */
  basePath?: string;
  title?: string;
  version?: string;
}

function fieldSchema(field: Field): JsonSchema {
  const base: JsonSchema = field.label ? { title: field.label } : {};

  switch (field.type) {
    case "text":
    case "textarea":
      return { ...base, type: "string", minLength: field.minLength, maxLength: field.maxLength };
    case "email":
      return { ...base, type: "string", format: "email" };
    case "boolean":
      return { ...base, type: "boolean" };
    case "number": {
      const type = field.kind === "integer" ? "integer" : "number";
      const minimum = field.min ?? (field.sign === "positive" ? 0 : undefined);
      const maximum = field.max ?? (field.sign === "negative" ? 0 : undefined);
      return { ...base, type, minimum, maximum };
    }
    case "select": {
      const values = field.options.map((option) => option.value);
      return field.multiple
        ? { ...base, type: "array", items: { type: "string", enum: values } }
        : { ...base, type: "string", enum: values };
    }
    case "relation":
      return field.multiple
        ? { ...base, type: "array", items: { type: "string" } }
        : { ...base, type: "string" };
  }
}

function collectionSchema(collection: CollectionSchema): JsonSchema {
  const properties: Record<string, JsonSchema> = { id: { type: "string" } };
  const required: string[] = [];

  for (const field of collection.fields) {
    properties[field.name] = fieldSchema(field);
    if (field.required) required.push(field.name);
  }

  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

function schemaRef(slug: string): { $ref: string } {
  return { $ref: `#/components/schemas/${slug}` };
}

function collectionPaths(collection: CollectionSchema, basePath: string): Record<string, Record<string, unknown>> {
  const ref = schemaRef(collection.slug);
  const tags = [collection.title];

  return {
    [`${basePath}/${collection.slug}`]: {
      get: {
        tags,
        summary: `List ${collection.plural}`,
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "where", in: "query", schema: { type: "string" }, description: "JSON-encoded field filters" },
          { name: "orderBy", in: "query", schema: { type: "string" }, description: "JSON-encoded sort order" },
        ],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "array", items: ref } } } },
        },
      },
      post: {
        tags,
        summary: `Create a ${collection.singular}`,
        requestBody: { required: true, content: { "application/json": { schema: ref } } },
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: ref } } },
          "400": { description: "Validation error" },
        },
      },
    },
    [`${basePath}/${collection.slug}/{id}`]: {
      get: {
        tags,
        summary: `Get a ${collection.singular}`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: ref } } },
          "404": { description: "Not found" },
        },
      },
      patch: {
        tags,
        summary: `Update a ${collection.singular}`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: ref } } },
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: ref } } },
          "400": { description: "Validation error" },
          "404": { description: "Not found" },
        },
      },
      delete: {
        tags,
        summary: `Delete a ${collection.singular}`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "204": { description: "No content" },
          "404": { description: "Not found" },
        },
      },
    },
  };
}

/**
 * Builds an OpenAPI 3.1 document describing the REST surface `createApiHandler` serves for
 * `collections`: one path pair (list/create, get/update/delete) per collection, mirroring
 * `handler.ts`'s routes exactly, plus a `components.schemas` entry per collection derived from its
 * fields (see `fieldSchema`). Pure and framework-agnostic, so it can be tested without HTTP.
 * @param collections - The collections to describe.
 * @param [options] - Options controlling the document, e.g. `basePath`.
 * @returns The OpenAPI 3.1 document describing `collections`.
 */
export function buildOpenApiDocument(
  collections: readonly CollectionSchema[],
  options: BuildOpenApiDocumentOptions = {},
): OpenApiDocument {
  const basePath = options.basePath ?? "/collections";
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, JsonSchema> = {};

  for (const collection of collections) {
    Object.assign(paths, collectionPaths(collection, basePath));
    schemas[collection.slug] = collectionSchema(collection);
  }

  return {
    openapi: "3.1.0",
    info: { title: options.title ?? "Shuri API", version: options.version ?? "0.0.0" },
    paths,
    components: { schemas },
  };
}
