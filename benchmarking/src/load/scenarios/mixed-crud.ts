import { samplePost } from "../../sut/schema.ts";
import { rotateIds, type CannonRequest } from "../autocannon.ts";
import { httpScenario } from "./index.ts";

/** A plausible read-heavy mix: 16 gets, 3 list pages, 1 insert per cycle of each connection. */
export const mixedCrud = httpScenario({
  id: "mixed-crud",
  sut: "open",
  description:
    "80% `GET /collections/posts/:id`, 15% `GET /collections/posts?limit=20`, 5% `POST /collections/posts`, cycled per connection.",
  requests: ({ ids }) => {
    const get: CannonRequest = {
      method: "GET",
      setupRequest: rotateIds(ids, (id) => `/collections/posts/${id}`),
    };
    const list: CannonRequest = { method: "GET", path: "/collections/posts?limit=20" };
    const create: CannonRequest = {
      method: "POST",
      path: "/collections/posts",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(samplePost(1)),
    };
    return [...Array.from({ length: 16 }, () => get), list, list, list, create];
  },
});
