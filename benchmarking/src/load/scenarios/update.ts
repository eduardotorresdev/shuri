import { rotateIds } from "../autocannon.ts";
import { httpScenario } from "./index.ts";

/** Partial update: a pre-image read, partial validation, the hook chain, one adapter update. */
export const update = httpScenario({
  id: "update",
  sut: "open",
  description:
    "`PATCH /collections/posts/:id` with `{ views }`, ids rotated over the fixtures. A pre-image `findOne`, partial `validateRecord`, hook chain, adapter update.",
  requests: ({ ids }) => [
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ views: 1 }),
      setupRequest: rotateIds(ids, (id) => `/collections/posts/${id}`),
    },
  ],
});
