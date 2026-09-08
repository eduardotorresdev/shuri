import { httpScenario } from "./index.ts";

/** The other read route; one map lookup behind it. */
export const getGlobal = httpScenario({
  id: "get-global",
  sut: "open",
  description: "`GET /globals/site`: the globals handler over a one-row lookup.",
  requests: () => [{ method: "GET", path: "/globals/site" }],
});
