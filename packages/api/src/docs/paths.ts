import type { CollectionSchema, GlobalSchema } from "@shuri/core";

function schemaRef(slug: string): { $ref: string } {
  return { $ref: `#/components/schemas/${slug}` };
}

export function collectionPaths(
  collection: CollectionSchema,
  basePath: string,
): Record<string, Record<string, unknown>> {
  const ref = schemaRef(collection.slug);
  const tags = [collection.title];

  return {
    [`${basePath}/${collection.slug}`]: {
      get: {
        tags,
        summary: `List ${collection.plural}`,
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 0 },
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", minimum: 0 },
          },
          {
            name: "where",
            in: "query",
            schema: { type: "string" },
            description: "JSON-encoded field filters",
          },
          {
            name: "orderBy",
            in: "query",
            schema: { type: "string" },
            description: "JSON-encoded sort order",
          },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": { schema: { type: "array", items: ref } },
            },
          },
        },
      },
      post: {
        tags,
        summary: `Create a ${collection.singular}`,
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref } },
        },
        responses: {
          "201": {
            description: "Created",
            content: { "application/json": { schema: ref } },
          },
          "400": { description: "Validation error" },
        },
      },
    },
    [`${basePath}/${collection.slug}/{id}`]: {
      get: {
        tags,
        summary: `Get a ${collection.singular}`,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: ref } },
          },
          "404": { description: "Not found" },
        },
      },
      patch: {
        tags,
        summary: `Update a ${collection.singular}`,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref } },
        },
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: ref } },
          },
          "400": { description: "Validation error" },
          "404": { description: "Not found" },
        },
      },
      delete: {
        tags,
        summary: `Delete a ${collection.singular}`,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "204": { description: "No content" },
          "404": { description: "Not found" },
        },
      },
    },
  };
}

export function globalPaths(
  global: GlobalSchema,
  basePath: string,
): Record<string, Record<string, unknown>> {
  const ref = schemaRef(global.slug);
  const tags = [global.category.title];

  return {
    [`${basePath}/${global.slug}`]: {
      get: {
        tags,
        summary: `Get ${global.title}`,
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: ref } },
          },
        },
      },
      patch: {
        tags,
        summary: `Update ${global.title}`,
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref } },
        },
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: ref } },
          },
          "400": { description: "Validation error" },
        },
      },
    },
  };
}
