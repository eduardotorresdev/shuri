import type { GlobalSchema } from "@shuri/core";
import { schemaRef } from "./ref.js";

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
