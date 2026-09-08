import { STORE_EVENT_TYPES } from "../../realtime/event.js";
import { GUARDED_RESPONSES, type OpenApiSecurity } from "../security.js";

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
 * @param [security] - The document's security, when access control is on.
 * @returns The OpenAPI path item for the event stream.
 */
export function realtimePaths(
  basePath: string,
  security?: OpenApiSecurity,
): Record<string, Record<string, unknown>> {
  return {
    [basePath]: {
      get: {
        tags: ["Events"],
        summary: "Stream change events",
        description: FRAME_FORMAT,
        // Gated per event by each slug's `list`/`read` rule rather than by one scope, so the
        // requirement names the schemes without a scope; an explicit selection the principal may
        // not read is refused when the stream opens.
        ...(security ? { security: security.requirements() } : {}),
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
          ...(security ? GUARDED_RESPONSES : {}),
        },
      },
    },
  };
}
