import type { CollectionSchema } from "@shuri/core";
import {
  GUARDED_RESPONSES,
  guardedOperation,
  type OpenApiSecurity,
} from "../security.js";
import { schemaRef } from "./ref.js";

/**
 * The path items of one collection's REST routes.
 * @param collection - The collection to describe.
 * @param basePath - The path prefix its routes are mounted under.
 * @param [security] - The document's security, when access control is on.
 * @returns The path items, keyed by path.
 */
export function collectionPaths(
  collection: CollectionSchema,
  basePath: string,
  security?: OpenApiSecurity,
): Record<string, Record<string, unknown>> {
  const ref = schemaRef(collection.slug);
  const tags = [collection.title];
  const guarded = (op: Parameters<typeof guardedOperation>[2]) =>
    guardedOperation(security, collection.slug, op);
  const errors = security ? GUARDED_RESPONSES : {};

  return {
    [`${basePath}/${collection.slug}`]: {
      get: {
        tags,
        summary: `List ${collection.plural}`,
        ...guarded("list"),
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
          ...errors,
        },
      },
      post: {
        tags,
        summary: `Create a ${collection.singular}`,
        ...guarded("create"),
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
          ...errors,
        },
      },
    },
    [`${basePath}/${collection.slug}/{id}`]: {
      get: {
        tags,
        summary: `Get a ${collection.singular}`,
        ...guarded("view"),
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
          ...errors,
        },
      },
      patch: {
        tags,
        summary: `Update a ${collection.singular}`,
        ...guarded("update"),
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
          ...errors,
        },
      },
      delete: {
        tags,
        summary: `Delete a ${collection.singular}`,
        ...guarded("delete"),
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
          ...errors,
        },
      },
    },
  };
}
