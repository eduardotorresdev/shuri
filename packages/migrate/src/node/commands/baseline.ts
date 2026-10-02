import { checksumOf } from "../../migration/checksum.js";
import { CliError } from "../errors.js";
import type { Env, Outcome } from "../types.js";
import { chainOf, stringOption, withLock } from "./shared.js";

/**
 * `baseline [--to <id>]`: adopts an existing database by recording the chain up to `id` (default: the
 * head) as applied, without running anything. The journal must be empty. The driver port has no
 * introspection, so it trusts that the database already has that schema; `generate init` + `baseline`
 * is the adoption path (see the plan, section 10.1).
 * @param env - Parsed command line.
 * @returns The ids recorded.
 * @throws {CliError} If the journal is not empty, the chain is empty or `--to` is not in it.
 */
export async function baseline(env: Env): Promise<Outcome> {
  const project = await env.project();
  const chain = chainOf(await project.dir.list());
  const to = stringOption(env, "to");
  const end = to === undefined ? chain.length - 1 : chain.findIndex((f) => f.id === to);
  if (chain.length === 0 || end < 0) {
    throw new CliError(
      chain.length === 0
        ? "there are no migrations to baseline"
        : `--to ${to} is not a migration of the chain`,
      chain.length === 0
        ? "run `shuri-migrate generate init` first"
        : "pick an id from `shuri-migrate status`",
    );
  }
  const driver = await project.driver();
  const recorded = await withLock(env, driver, async () => {
    const existing = await driver.applied();
    if (existing.length > 0) {
      throw new CliError(
        `the journal is not empty (${existing.length} migration(s) recorded): baseline only adopts a database that has never been migrated`,
        "use `shuri-migrate mark-applied <id>` to fix individual entries",
      );
    }
    const ids: string[] = [];
    for (const file of chain.slice(0, end + 1)) {
      await driver.journal.markApplied({ id: file.id, checksum: await checksumOf(file) });
      ids.push(file.id);
    }
    return ids;
  });
  return {
    text: `baselined ${recorded.length} migration(s) up to ${recorded[recorded.length - 1]}`,
    result: { baselined: recorded },
  };
}
