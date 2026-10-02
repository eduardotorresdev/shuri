import { chainOf, rewriteBundle } from "./shared.js";
import type { Env, Outcome } from "../types.js";

/**
 * `bundle`: writes `<dir>/index.ts` (or `bundle.out`) importing every migration in chain order.
 * @param env - Parsed command line.
 * @returns The path written and the number of migrations.
 * @throws {MultipleHeadsError} If branches are not reconciled yet.
 */
export async function bundle(env: Env): Promise<Outcome> {
  const project = await env.project();
  const files = await project.dir.list();
  chainOf(files);
  const chain = await rewriteBundle(project, files);
  return {
    text: `wrote ${project.bundleOut} (${chain.length} migration${chain.length === 1 ? "" : "s"})`,
    result: { path: project.bundleOut, migrations: chain.map((f) => f.id) },
  };
}
