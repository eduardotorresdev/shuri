import { migrationStatus, type MigrationStatus } from "../../runner/status.js";
import { describeOp } from "../../graph/format-conflict.js";
import type { Env, Outcome } from "../types.js";
import { chainOf, flagOption } from "./shared.js";

function list(label: string, ids: readonly string[]): string[] {
  return ids.length === 0 ? [] : [`${label}:`, ...ids.map((id) => `  ${id}`)];
}

/**
 * @param s - The status of a database against the migration files.
 * @returns A human-readable report; problems first, one section per kind.
 */
export function formatStatus(s: MigrationStatus): string {
  const done = s.applied.filter((e) => e.status === "done").length;
  return [
    `${s.chain.length} migration(s) in the chain; ${done} applied, ${s.pending.length} pending`,
    ...list("pending", s.pending),
    ...list("interrupted (running; `up` re-runs them)", s.running),
    ...list("applied but missing from the files", s.unknownApplied),
    ...list("edited after they ran (checksum differs)", s.checksumMismatch),
    ...list("pending but older than an applied migration", s.outOfOrder),
    ...(s.outOfOrderConflict
      ? ["the real application order does not end in the schema the chain produces"]
      : []),
    ...(s.schemaDrift
      ? [
          "schema in code differs from the migrations:",
          ...s.schemaDrift.map((op) => `  ${describeOp(op)}`),
        ]
      : []),
  ].join("\n");
}

/**
 * `status [--exit-code]`: compares the files with the database.
 * @param env - Parsed command line.
 * @returns The status. With `--exit-code`: 4 when something is pending or the schema drifted, 7 when
 *   the journal cannot be trusted, 3 when the real order conflicts with the chain.
 */
export async function status(env: Env): Promise<Outcome> {
  const project = await env.project();
  const files = await project.dir.list();
  chainOf(files);
  const result = await migrationStatus({
    files,
    driver: await project.driver(),
    schema: await project.schema(),
  });
  let exit = 0;
  if (flagOption(env, "exit-code")) {
    if (result.unknownApplied.length > 0 || result.checksumMismatch.length > 0) exit = 7;
    else if (result.outOfOrderConflict) exit = 3;
    else if (
      result.pending.length > 0 ||
      result.running.length > 0 ||
      result.schemaDrift
    ) {
      exit = 4;
    }
  }
  return { exit, text: formatStatus(result), result };
}
