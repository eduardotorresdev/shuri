import { rotateIds } from "../autocannon.ts";
import { httpScenario } from "./index.ts";

/** `get-record` with a client token: a scan of `_client_tokens` (one row) plus scope expansion per request. */
export const authClient = httpScenario({
  id: "auth-client",
  sut: "auth",
  description:
    "`GET /collections/posts/:id` with `Authorization: Bearer sct_...`. The `sct_` prefix routes to `_client_tokens` (one seeded row), then the client's roles are expanded against the schema's scopes on every request.",
  requests: ({ ids, clientToken }) => [
    {
      method: "GET",
      headers: { authorization: `Bearer ${clientToken ?? ""}` },
      setupRequest: rotateIds(ids, (id) => `/collections/posts/${id}`),
    },
  ],
});
