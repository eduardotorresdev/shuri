import type { GlobalSchema } from "@shuri/core";
import {
  GUARDED_RESPONSES,
  guardedOperation,
  type OpenApiSecurity,
} from "../security.js";
import { schemaRef } from "./ref.js";

/**
 * The path item of one global's REST routes.
 * @param global - The global to describe.
 * @param basePath - The path prefix its routes are mounted under.
 * @param [security] - The document's security, when access control is on.
 * @returns The path item, keyed by path.
 */
export function globalPaths(
  global: GlobalSchema,
  basePath: string,
  security?: OpenApiSecurity,
): Record<string, Record<string, unknown>> {
  const ref = schemaRef(global.slug);
  const tags = [global.category.title];
  const errors = security ? GUARDED_RESPONSES : {};

  return {
    [`${basePath}/${global.slug}`]: {
      get: {
        tags,
        summary: `Get ${global.title}`,
        ...guardedOperation(security, global.slug, "read"),
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: ref } },
          },
          ...errors,
        },
      },
      patch: {
        tags,
        summary: `Update ${global.title}`,
        ...guardedOperation(security, global.slug, "update"),
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
          ...errors,
        },
      },
    },
  };
}
