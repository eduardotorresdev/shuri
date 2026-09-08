import { rotateIds } from "../autocannon.ts";
import { httpScenario } from "./index.ts";

/** The cheapest read: one `findOne` by id, one record serialized. The baseline every other route is measured against. */
export const getRecord = httpScenario({
  id: "get-record",
  sut: "open",
  connections: "sweep",
  description:
    "`GET /collections/posts/:id`, ids rotated over the first 1000 seeded posts. The floor of the HTTP bridge + one `findOne` + one JSON record.",
  requests: ({ ids }) => [
    { method: "GET", setupRequest: rotateIds(ids, (id) => `/collections/posts/${id}`) },
  ],
});
