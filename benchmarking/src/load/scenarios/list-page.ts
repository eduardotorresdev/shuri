import { httpScenario } from "./index.ts";

/** A page off the table: the memory adapter pages straight off its iterator, Mongo returns the 20 rows. */
export const listPage = httpScenario({
  id: "list-page",
  sut: "open",
  description:
    "`GET /collections/posts?limit=20`: no filter, no sort, so the memory adapter pages straight off its table iterator and the cost is the 20 records, not the seed.",
  requests: () => [{ method: "GET", path: "/collections/posts?limit=20" }],
});
