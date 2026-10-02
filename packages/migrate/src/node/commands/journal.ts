import { checksumOf } from "../../migration/checksum.js";
import type { MigrationFile } from "../../migration/types.js";
import { CliError } from "../errors.js";
import type { Env, Outcome } from "../types.js";
import { chainOf, confirm, withLock } from "./shared.js";

async function chainFileOf(env: Env, id: string): Promise<MigrationFile | undefined> {
  const files = await (await env.project()).dir.list();
  return chainOf(files).find((f) => f.id === id);
}

/**
 * `mark-applied <id>`: records a migration as applied without running it (after applying it by hand).
 * @param env - Parsed command line.
 * @returns The id recorded.
 * @throws {CliError} If the id is not in the chain, is already recorded or is not confirmed.
 */
export async function markApplied(env: Env): Promise<Outcome> {
  const [id] = env.positionals;
  const driver = await (await env.project()).driver();
  const file = await chainFileOf(env, id);
  if (!file) {
    throw new CliError(
      `${id} is not a migration of the chain`,
      "check the id with `shuri-migrate status`",
    );
  }
  await confirm(env, `record ${id} as applied WITHOUT running it?`, `mark-applied ${id}`);
  await withLock(env, driver, async () => {
    if ((await driver.applied()).some((e) => e.id === id)) {
      throw new CliError(
        `${id} is already in the journal`,
        "nothing to do; see `shuri-migrate status`",
      );
    }
    await driver.journal.markApplied({ id, checksum: await checksumOf(file) });
  });
  return { text: `marked ${id} as applied`, result: { id } };
}

/**
 * `unmark <id>`: removes a migration from the journal (it will run again on the next `up`).
 * @param env - Parsed command line.
 * @returns The id removed.
 * @throws {CliError} If the id is not in the journal or is not confirmed.
 */
export async function unmark(env: Env): Promise<Outcome> {
  const [id] = env.positionals;
  const driver = await (await env.project()).driver();
  if (!(await driver.applied()).some((e) => e.id === id)) {
    throw new CliError(
      `${id} is not in the journal`,
      "check the id with `shuri-migrate status`",
    );
  }
  await confirm(
    env,
    `remove ${id} from the journal? \`up\` will run it again`,
    `unmark ${id}`,
  );
  await withLock(env, driver, () => driver.journal.unmark(id));
  return { text: `unmarked ${id}`, result: { id } };
}

/**
 * `repair-checksum <id>`: rewrites the journal's checksum of an applied migration from the file, after
 * an edit you know does not change what ran.
 * @param env - Parsed command line.
 * @returns The new checksum.
 * @throws {CliError} If the migration has no file, is not in the journal or is not confirmed.
 */
export async function repairChecksum(env: Env): Promise<Outcome> {
  const [id] = env.positionals;
  const driver = await (await env.project()).driver();
  const file = await chainFileOf(env, id);
  if (!file) {
    throw new CliError(
      `${id} is not a migration of the chain`,
      "check the id with `shuri-migrate status`",
    );
  }
  const entry = (await driver.applied()).find((e) => e.id === id);
  if (!entry) {
    throw new CliError(
      `${id} is not in the journal`,
      `run \`shuri-migrate up\` to apply it`,
    );
  }
  const checksum = await checksumOf(file);
  if (entry.checksum === checksum) {
    return {
      text: `${id} already has the file's checksum`,
      result: { id, checksum, changed: false },
    };
  }
  await confirm(
    env,
    `overwrite the journal checksum of ${id} with the file's?`,
    `repair-checksum ${id}`,
  );
  await withLock(env, driver, () => driver.journal.setChecksum(id, checksum));
  return {
    text: `repaired the checksum of ${id}\n  was ${entry.checksum}\n  now ${checksum}`,
    result: { id, checksum, previous: entry.checksum, changed: true },
  };
}
