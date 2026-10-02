import { DestructiveMigrationError } from "../../errors/runner.js";
import { describeOp } from "../../graph/format-conflict.js";
import { migrateUp, type MigrateUpOptions } from "../../runner/up.js";
import { CliUsageError } from "../errors.js";
import type { Env, Outcome } from "../types.js";
import { flagOption, stringOption } from "./shared.js";

function waitOf(env: Env): number | undefined {
  const raw = stringOption(env, "wait");
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw))
    throw new CliUsageError(`--wait expects milliseconds, got "${raw}"`);
  return Number(raw);
}

function approvalOf(env: Env): MigrateUpOptions["allowDestructive"] {
  const ids = stringOption(env, "allow-destructive");
  if (flagOption(env, "allow-destructive-all")) {
    if (ids !== undefined) {
      throw new CliUsageError(
        "use either --allow-destructive <ids> or --allow-destructive-all",
      );
    }
    return "all";
  }
  return ids === undefined ? undefined : ids.split(",").filter((id) => id !== "");
}

/**
 * `up`: applies the pending migrations. On a terminal, destructive migrations that were not approved
 * by flag are listed and confirmed interactively; without one they stop the run (exit 6).
 * @param env - Parsed command line.
 * @returns The ids applied and, with `--dry-run`, the driver's plans.
 */
export async function up(env: Env): Promise<Outcome> {
  const project = await env.project();
  const options: MigrateUpOptions = {
    files: await project.dir.list(),
    driver: await project.driver(),
    schema: await project.schema(),
    dryRun: flagOption(env, "dry-run"),
    allowDestructive: approvalOf(env),
    waitForLockMs: waitOf(env),
    now: env.deps.now,
    sleep: env.deps.sleep,
  };
  let outcome;
  try {
    outcome = await migrateUp(options);
  } catch (error) {
    if (
      !(error instanceof DestructiveMigrationError) ||
      !env.io.isTTY ||
      !env.io.prompt
    ) {
      throw error;
    }
    env.io.stdout(
      `destructive operations need approval:\n${error.items.map((i) => `  ${i.migration}: ${describeOp(i.op)}`).join("\n")}\n`,
    );
    if (!(await env.io.prompt("Apply them? [y/N] "))) throw error;
    const already = Array.isArray(options.allowDestructive)
      ? options.allowDestructive
      : [];
    const approved = [...new Set([...already, ...error.items.map((i) => i.migration)])];
    outcome = await migrateUp({ ...options, allowDestructive: approved });
  }
  if (options.dryRun) {
    const lines = outcome.plans.flatMap((plan) => [
      `would apply ${plan.migration.id}`,
      ...plan.steps.map(
        (step) =>
          `  ${step.destructive ? "[destructive] " : ""}${step.description}${step.estimatedRows === undefined ? "" : ` (~${step.estimatedRows} rows)`}`,
      ),
    ]);
    return {
      text: lines.length > 0 ? lines.join("\n") : "nothing to apply",
      result: { dryRun: true, plans: outcome.plans },
    };
  }
  return {
    text:
      outcome.applied.length > 0
        ? `applied ${outcome.applied.length} migration(s):\n${outcome.applied.map((id) => `  ${id}`).join("\n")}`
        : "nothing to apply: the database is up to date",
    result: { applied: outcome.applied },
  };
}
