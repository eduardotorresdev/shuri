import { httpScenario } from "./index.ts";

/** The document is built once and cached; this measures serializing and sending it. */
export const openapi = httpScenario({
  id: "openapi",
  sut: "open",
  description:
    "`GET /openapi.json`: the document is built once at first request and cached, so this is `JSON.stringify` + the bytes on the wire.",
  requests: () => [{ method: "GET", path: "/openapi.json" }],
});
