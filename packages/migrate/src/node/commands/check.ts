import { DriverLimitError } from "../../errors/runner.js";
import { describeOp } from "../../graph/format-conflict.js";
import { diff } from "../../ops/diff.js";
import { replay } from "../../ops/replay.js";
import { snapshotOf } from "../../schema/snapshot.js";
import { bundleState } from "../bundle.js";
import type { Env, Outcome } from "../types.js";
import { chainOf } from "./shared.js";

interface Problem {
  kind: "drift" | "bundle";
  message: string;
}

/**
 * `check`: validates everything that needs no database. Parses every file, requires one head, replays
 * the chain, compares it with the schema in code, applies the driver's limits (when an adapter is
 * configured) and requires the bundle to be up to date.
 * @param env - Parsed command line.
 * @returns Exit 0 when clean; 4 when the schema drifted or the bundle is stale. Invalid files, several
 *   heads (3), a chain that does not replay and driver limits are errors.
 */
export async function check(env: Env): Promise<Outcome> {
  const project = await env.project();
  const files = await project.dir.list();
  const chain = chainOf(files);
  const state = replay(chain);

  const driver = await project.optionalDriver();
  const issues = driver?.validateSnapshot?.(state.snapshot) ?? [];
  if (issues.length > 0) throw new DriverLimitError(issues);

  const problems: Problem[] = [];
  const { ops } = diff(state.snapshot, snapshotOf(await project.schema()));
  if (ops.length > 0) {
    problems.push({
      kind: "drift",
      message: `schema in code differs from the migrations (run \`shuri-migrate generate <name>\`):\n${ops.map((op) => `    ${describeOp(op)}`).join("\n")}`,
    });
  }
  const bundle = await bundleState(
    { out: project.bundleOut, dir: project.dirPath },
    chain,
  );
  if (bundle !== "current") {
    problems.push({
      kind: "bundle",
      message: `bundle ${project.bundleOut} is ${bundle} (run \`shuri-migrate bundle\`)`,
    });
  }
  const warnings = [
    ...(project.config.frozenRef
      ? []
      : [
          'frozenRef is not configured: a migration already in production can be rebased by `reconcile`; set `frozenRef: "origin/main"` in shuri.migrate.ts',
        ]),
    ...(driver?.warnings?.() ?? []),
  ];

  const lines = [
    `${chain.length} migration(s), one head, chain replays${problems.length === 0 ? ", no drift, bundle current" : ""}`,
    ...problems.map((p) => `problem: ${p.message}`),
    ...warnings.map((w) => `warning: ${w}`),
  ];
  return {
    exit: problems.length > 0 ? 4 : 0,
    text: lines.join("\n"),
    result: { migrations: chain.length, problems, warnings },
  };
}
