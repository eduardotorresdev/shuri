import { httpScenario } from "./index.ts";

const query = new URLSearchParams({
  where: JSON.stringify({ published: { op: "eq", value: true } }),
  orderBy: JSON.stringify([{ field: "title" }]),
  limit: "20",
});

/** Filter + sort + page: the `eq` on `published` comes off its index, then a `localeCompare` sort of the ~50% that matched. */
export const listFiltered = httpScenario({
  id: "list-filtered",
  sut: "open",
  description:
    "`GET /collections/posts?where={published eq true}&orderBy=[{title}]&limit=20`: the `eq` on `published` (indexed) yields ~50% of the table, which is then sorted by `title` and paged to 20. The sort is the cost.",
  requests: () => [{ method: "GET", path: `/collections/posts?${query}` }],
});
