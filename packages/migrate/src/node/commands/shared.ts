import type { MigrationDriver, MigrationLock } from "../../driver/types.js";
import { MigrationLockedError } from "../../errors/runner.js";
import { buildGraph, linearChain } from "../../graph/graph.js";
import type { MigrationFile } from "../../migration/types.js";
import { writeBundle } from "../bundle.js";
import { CliError } from "../errors.js";
import type { Env, Project } from "../types.js";

/**
 * @param env - Parsed command line.
 * @param name - Option name.
 * @returns The option's string value, if given.
 */
export function stringOption(env: Env, name: string): string | undefined {
  const value = env.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * @param env - Parsed command line.
 * @param name - Option name.
 * @returns Whether the boolean flag was passed.
 */
export function flagOption(env: Env, name: string): boolean {
  return env.values[name] === true;
}

/**
 * @param env - Parsed command line.
 * @param name - Option name (repeatable).
 * @returns Every value given, in order.
 */
export function listOption(env: Env, name: string): string[] {
  const value = env.values[name];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * @param files - Migration files.
 * @returns The linear chain.
 * @throws {GraphError} If the files are not a valid graph.
 * @throws {MultipleHeadsError} If branches are not reconciled yet.
 */
export const chainOf = (files: readonly MigrationFile[]): MigrationFile[] =>
  linearChain(buildGraph(files));

/**
 * The frozen set for a reconcile, read from git only when there are branches to reconcile (a linear
 * chain needs no git, so `generate` works in a fresh clone that has no `origin/main`).
 * @param project - The loaded project.
 * @param files - Every migration file.
 * @returns The ids at `frozenRef`; `undefined` when none is configured or nothing needs reconciling.
 */
export async function frozenFor(
  project: Project,
  files: readonly MigrationFile[],
): Promise<Set<string> | undefined> {
  return buildGraph(files).heads.length > 1 ? project.frozen() : undefined;
}

/**
 * Regenerates the bundle for the chain in `files`.
 * @param project - The loaded project.
 * @param files - Every migration file (must form one chain).
 * @returns The chain written to the bundle.
 * @throws {MultipleHeadsError} If branches are not reconciled yet.
 */
export async function rewriteBundle(
  project: Project,
  files: readonly MigrationFile[],
): Promise<MigrationFile[]> {
  const chain = chainOf(files);
  await writeBundle({ out: project.bundleOut, dir: project.dirPath }, chain);
  return chain;
}

/**
 * Asks before a manual correction: `--yes` skips it; a terminal asks; anything else refuses.
 * @param env - Parsed command line.
 * @param question - What is about to happen.
 * @param command - The command, for the "re-run with --yes" hint.
 * @throws {CliError} If the user declines or there is no way to ask.
 */
export async function confirm(
  env: Env,
  question: string,
  command: string,
): Promise<void> {
  if (flagOption(env, "yes")) return;
  if (!env.io.isTTY || !env.io.prompt) {
    throw new CliError(
      `confirmation required: ${question}`,
      `re-run \`shuri-migrate ${command} --yes\` to confirm`,
    );
  }
  if (!(await env.io.prompt(`${question} [y/N] `))) {
    throw new CliError("aborted: nothing was changed", "re-run when you are sure");
  }
}

/**
 * Runs `work` holding the migration lock, so a manual journal edit cannot race a deploy.
 * @param env - Parsed command line (holder name).
 * @param driver - The driver to lock.
 * @param work - What to do while holding the lock.
 * @returns What `work` returns.
 * @throws {MigrationLockedError} If another process holds the lock.
 */
export async function withLock<T>(
  env: Env,
  driver: MigrationDriver,
  work: (lock: MigrationLock) => Promise<T>,
): Promise<T> {
  const lock = await driver.acquireLock(
    `shuri-migrate-${globalThis.crypto.randomUUID()}`,
    60_000,
    env.now,
  );
  if (!lock) {
    const info = await driver.lockInfo();
    throw new MigrationLockedError(
      info?.holder ?? "unknown",
      info?.expiresAt ?? "unknown",
    );
  }
  try {
    return await work(lock);
  } finally {
    await lock.release();
  }
}
