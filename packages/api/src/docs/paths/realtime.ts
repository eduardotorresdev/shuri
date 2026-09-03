import { STORE_EVENT_TYPES } from "@shuri/store";

const FRAME_FORMAT = `Server-Sent Events stream. Each message is \`event: <type>\\ndata: <json>\\n\\n\`,
where \`<type>\` is one of ${STORE_EVENT_TYPES.join(", ")} and \`<json>\` carries the changed resource:
\`{ collection, id, record }\` for a collection create/update, \`{ collection, id }\` for a delete
(no pre-image is kept), and \`{ global, record }\` for a global update. Idle connections receive a
\`: keep-alive\` comment periodically.`;

function listParameter(name: string, description: string): Record<string, unknown> {
  return {
    name,
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    explode: true,
    description: `${description} Repeat the param or separate values with commas.`,
  };
}

/**
 * Describes the event stream endpoint. OpenAPI 3.1 has no vocabulary for individual SSE messages, so
 * the response is typed as `text/event-stream` with the frame format spelled out in prose — the
 * standard workaround, and what Scalar renders.
 * @param basePath - The path the event stream is mounted at.
 * @returns The OpenAPI path item for the event stream.
 */
export function realtimePaths(basePath: string): Record<string, Record<string, unknown>> {
  return {
    [basePath]: {
      get: {
        tags: ["Events"],
        summary: "Stream change events",
        description: FRAME_FORMAT,
        parameters: [
          listParameter("collection", "Only events of these collections."),
          listParameter("global", "Only events of these globals."),
          listParameter("id", "Only events of these record ids."),
          {
            name: "events",
            in: "query",
            schema: {
              type: "array",
              items: { type: "string", enum: [...STORE_EVENT_TYPES] },
            },
            explode: true,
            description:
              "Only these event types. Repeat the param or separate values with commas.",
          },
        ],
        responses: {
          "200": {
            description: "Event stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          "400": { description: "Invalid selection" },
          "404": { description: "Unknown collection or global" },
        },
      },
    },
  };
}
