import { applyRewrites, planReconcile } from "../../graph/reconcile.js";
import type { MigrationFile } from "../../migration/types.js";
import type { Env, Outcome } from "../types.js";
import { flagOption, frozenFor, rewriteBundle } from "./shared.js";

/**
 * `reconcile [--dry-run]`: turns parallel branches into one chain by rewriting `parent`, then rebundles.
 * @param env - Parsed command line.
 * @returns The rewrites and the resulting chain.
 */
export async function reconcile(env: Env): Promise<Outcome> {
  const project = await env.project();
  const files = await project.dir.list();
  const plan = planReconcile(files, { frozen: await frozenFor(project, files) });
  const dry = flagOption(env, "dry-run");
  const result = { rewrites: plan.rewrites, chain: plan.chain, dryRun: dry };
  if (plan.rewrites.length === 0) {
    if (!dry) await rewriteBundle(project, files);
    return { text: "already linear: nothing to reconcile", result };
  }
  const lines = plan.rewrites.map(
    (r) => `${dry ? "would rebase" : "rebased"} ${r.id} onto ${r.parent ?? "(root)"}`,
  );
  if (!dry) {
    const rebased = applyRewrites(files, plan.rewrites);
    for (const rewrite of plan.rewrites) {
      await project.dir.write(rebased.find((f) => f.id === rewrite.id) as MigrationFile);
    }
    await rewriteBundle(project, rebased);
  }
  return { text: lines.join("\n"), result };
}
