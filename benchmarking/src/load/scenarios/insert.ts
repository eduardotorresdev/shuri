import { samplePost } from "../../sut/schema.ts";
import { httpScenario } from "./index.ts";

const JSON_HEADERS = { "content-type": "application/json" };

/** The cheapest write: body parse, `validateRecord` over six fields, the `beforeChange`/`afterChange` chain, one adapter insert. */
export const insert = httpScenario({
  id: "insert",
  sut: "open",
  connections: "sweep",
  description:
    "`POST /collections/posts` with all six fields set. Body parsing + `validateRecord` + hook chain + adapter insert. The table grows by the number of requests, which the read scenarios that follow do not see: they run first.",
  requests: () => [
    {
      method: "POST",
      path: "/collections/posts",
      headers: JSON_HEADERS,
      body: JSON.stringify(samplePost(0)),
    },
  ],
});
