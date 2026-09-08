import { rotateIds } from "../autocannon.ts";
import { httpScenario } from "./index.ts";

/** `get-record` with a session cookie: the same read plus a SHA-256 and an O(sessions) scan of `_sessions`. */
export const authSession = httpScenario({
  id: "auth-session",
  sut: "auth",
  connections: "sweep",
  description:
    "`GET /collections/posts/:id` with `Cookie: shuri_session=...` among `--sessions` seeded rows. Compare with `get-record`: the difference is principal resolution — a SHA-256 and a `findMany` with `eq` on `tokenHash`, which both adapters answer through the field's index.",
  requests: ({ ids, sessionCookie }) => [
    {
      method: "GET",
      headers: { cookie: sessionCookie ?? "" },
      setupRequest: rotateIds(ids, (id) => `/collections/posts/${id}`),
    },
  ],
});
