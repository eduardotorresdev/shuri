import { rotateIds } from "../autocannon.ts";
import { httpScenario } from "./index.ts";

/** `get-record` with a session cookie: the same read plus better-auth's session lookup among `--sessions` rows. */
export const authSession = httpScenario({
  id: "auth-session",
  sut: "auth",
  connections: "sweep",
  description:
    "`GET /collections/posts/:id` with better-auth's session cookie among `--sessions` seeded rows. Compare with `get-record`: the difference is principal resolution — the cookie's signature check and a `findMany` with `eq` on `session.token`, which both adapters answer through the field's index.",
  requests: ({ ids, sessionCookie }) => [
    {
      method: "GET",
      headers: { cookie: sessionCookie ?? "" },
      setupRequest: rotateIds(ids, (id) => `/collections/posts/${id}`),
    },
  ],
});
