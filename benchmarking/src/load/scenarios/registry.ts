import type { Scenario } from "./index.ts";
import { authSession } from "./auth-session.ts";
import { getGlobal } from "./get-global.ts";
import { getRecord } from "./get-record.ts";
import { insert } from "./insert.ts";
import { listFiltered } from "./list-filtered.ts";
import { listPage } from "./list-page.ts";
import { login } from "./login.ts";
import { loginNoise } from "./login-noise.ts";
import { mixedCrud } from "./mixed-crud.ts";
import { openapi } from "./openapi.ts";
import { sseFanout } from "./sse-fanout.ts";
import { update } from "./update.ts";

/**
 * Every scenario, in the order they run. Consecutive scenarios of one profile share a boot, so
 * this order is also the boot order: open, then auth, then open again for `sse-fanout`. Reads run
 * before writes within a profile, so the read numbers describe the seeded table rather than one
 * grown by the insert sweep; `sse-fanout` goes last because a subscriber level can take the SUT
 * (or, on macOS, the Docker VM's network) down, and nothing else should be lost when it does.
 */
export const scenarios: readonly Scenario[] = [
  getRecord,
  listPage,
  listFiltered,
  getGlobal,
  openapi,
  update,
  insert,
  mixedCrud,
  authSession,
  login,
  loginNoise,
  sseFanout,
];

/**
 * Resolves `--scenarios a,b` against the registry, in registry order.
 * @param ids - The ids asked for, or `undefined` for all.
 * @returns The scenarios to run.
 */
export function selectScenarios(ids: string[] | undefined): Scenario[] {
  if (!ids) return [...scenarios];
  const unknown = ids.filter((id) => !scenarios.some((scenario) => scenario.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown scenario(s): ${unknown.join(", ")}. Known: ${scenarios.map((s) => s.id).join(", ")}`,
    );
  }
  return scenarios.filter((scenario) => ids.includes(scenario.id));
}
