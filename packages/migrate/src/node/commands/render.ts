import { inspect } from "../../runner/status.js";
import { planSequence } from "../../runner/plan.js";
import { CliError } from "../errors.js";
import type { Env, Outcome } from "../types.js";

/**
 * `render <id>`: the driver's textual plan (SQL) for one migration, over the database's real order.
 * @param env - Parsed command line.
 * @returns The rendered text.
 * @throws {CliError} If the id is not in the chain or the driver cannot render.
 */
export async function render(env: Env): Promise<Outcome> {
  const [id] = env.positionals;
  const project = await env.project();
  const driver = await project.driver();
  if (!driver.capabilities.render || !driver.render) {
    throw new CliError(
      "this driver cannot render a plan as text",
      "render is for SQL drivers (D1); use `shuri-migrate up --dry-run` to see the steps",
    );
  }
  const inspection = await inspect({ files: await project.dir.list(), driver });
  if (!inspection.chain.some((f) => f.id === id)) {
    throw new CliError(
      `${id} is not a migration of the chain`,
      "check the id with `shuri-migrate status`",
    );
  }
  const [planned] = planSequence(inspection.order, inspection.checksums, new Set([id]));
  const text = driver.render(await driver.plan(planned));
  return { text: text.replace(/\n$/, ""), result: { id, sql: text } };
}
