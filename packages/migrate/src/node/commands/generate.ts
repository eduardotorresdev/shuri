import { describeOp } from "../../graph/format-conflict.js";
import { applyRewrites, planReconcile } from "../../graph/reconcile.js";
import { newMigrationId } from "../../migration/id.js";
import type { MigrationFile } from "../../migration/types.js";
import { isDestructive } from "../../ops/conversion.js";
import { diff, type RenameHints } from "../../ops/diff.js";
import { replay } from "../../ops/replay.js";
import type { TargetKind } from "../../ops/types.js";
import { snapshotOf } from "../../schema/snapshot.js";
import { CliUsageError } from "../errors.js";
import type { Env, Outcome } from "../types.js";
import { chainOf, flagOption, frozenFor, listOption, rewriteBundle } from "./shared.js";

const KIND = "(collection|global)";
const ENTITY_FLAG = new RegExp(`^${KIND}:([^=.:]+)=([^=.:]+)$`);
const FIELD_FLAG = new RegExp(`^${KIND}:([^=.:]+)\\.([^=.:]+)=([^=.:]+)$`);

/**
 * Reads `--rename-entity kind:from=to` and `--rename-field kind:slug.from=to` (the slug is the NEW one).
 * @param entities - Values of `--rename-entity`.
 * @param fields - Values of `--rename-field`.
 * @returns The hints for `diff`.
 * @throws {CliUsageError} For a value that does not match the syntax.
 */
export function parseRenameHints(
  entities: readonly string[],
  fields: readonly string[],
): RenameHints {
  return {
    entities: entities.map((value) => {
      const m = ENTITY_FLAG.exec(value);
      if (!m) {
        throw new CliUsageError(
          `invalid --rename-entity "${value}"; expected kind:from=to (e.g. collection:tags=labels)`,
        );
      }
      return { kind: m[1] as TargetKind, from: m[2], to: m[3] };
    }),
    fields: fields.map((value) => {
      const m = FIELD_FLAG.exec(value);
      if (!m) {
        throw new CliUsageError(
          `invalid --rename-field "${value}"; expected kind:slug.from=to with the NEW slug (e.g. collection:posts.title=name)`,
        );
      }
      return { target: { kind: m[1] as TargetKind, slug: m[2] }, from: m[3], to: m[4] };
    }),
  };
}

// Reconciles parallel branches on disk and returns the files after the rewrites.
async function reconcileFirst(env: Env, files: MigrationFile[], lines: string[]) {
  const project = await env.project();
  const plan = planReconcile(files, { frozen: await frozenFor(project, files) });
  const rebased = applyRewrites(files, plan.rewrites);
  for (const rewrite of plan.rewrites) {
    const file = rebased.find((f) => f.id === rewrite.id) as MigrationFile;
    await project.dir.write(file);
    lines.push(`rebased ${rewrite.id} onto ${rewrite.parent ?? "(root)"}`);
  }
  return { files: rebased, rewrites: plan.rewrites };
}

/**
 * `generate <name>`: reconciles, diffs the schema in code against the migrations and writes the new file.
 * @param env - Parsed command line.
 * @returns The ops generated, which of them are destructive, and the rename warnings.
 */
export async function generate(env: Env): Promise<Outcome> {
  const project = await env.project();
  const [name] = env.positionals;
  const lines: string[] = [];
  let files = await project.dir.list();
  let rewrites: { id: string; parent: string | null }[] = [];
  if (!flagOption(env, "no-reconcile")) {
    ({ files, rewrites } = await reconcileFirst(env, files, lines));
  }
  const chain = chainOf(files);
  const hints = parseRenameHints(
    listOption(env, "rename-entity"),
    listOption(env, "rename-field"),
  );
  const prev = replay(chain).snapshot;
  const { ops, warnings } = diff(prev, snapshotOf(await project.schema()), hints);
  if (ops.length === 0) {
    await rewriteBundle(project, files);
    lines.push("nothing to generate: the schema in code already matches the migrations");
    return { text: lines.join("\n"), result: { generated: null, rewrites, warnings } };
  }
  const file: MigrationFile = {
    format: 1,
    id: newMigrationId(name, env.now(), env.random4hex),
    parent: chain.length > 0 ? chain[chain.length - 1].id : null,
    ops,
  };
  await project.dir.write(file);
  await rewriteBundle(project, [...files, file]);

  const destructive = ops.filter(isDestructive);
  lines.push(`generated ${file.id}`, ...ops.map((op) => `  ${describeOp(op)}`));
  if (destructive.length > 0) {
    lines.push(
      "destructive (needs approval to run):",
      ...destructive.map((op) => `  ${describeOp(op)}`),
      `  approve with \`shuri-migrate up --allow-destructive ${file.id}\``,
    );
  }
  for (const w of warnings) {
    lines.push(
      `warning: in ${w.target.kind} ${w.target.slug}, dropField ${w.dropped} and addField ${w.added} have the same shape; if it is a rename, delete ${file.id}.json and re-run with --rename-field ${w.target.kind}:${w.target.slug}.${w.dropped}=${w.added}`,
    );
  }
  return {
    text: lines.join("\n"),
    result: { generated: file.id, ops, destructive, warnings, rewrites },
  };
}
