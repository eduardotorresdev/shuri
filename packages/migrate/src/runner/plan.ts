import type { AppliedMigration, PlannedMigration, PlannedOp } from "../driver/types.js";
import type { MigrationFile, MigrationId } from "../migration/types.js";
import { applyMigration, applyOp } from "../ops/replay.js";
import { EMPTY_STATE, type ReplayState } from "../ops/state.js";
import type { MigrationOp, TargetRef } from "../ops/types.js";
import { compareCodePoints } from "../schema/canonical-json.js";
import type { EntitySnapshot, SchemaSnapshot } from "../schema/snapshot.js";

function relatesTo(entity: EntitySnapshot, collection: string): boolean {
  return Object.values(entity.fields).some(
    (spec) => spec.type === "relation" && spec.collection === collection,
  );
}

/**
 * @param snapshot - A schema.
 * @param target - An entity.
 * @returns The other entities with a relation to `target` (only collections can be targets), sorted:
 *   collections first, then globals, by slug.
 */
export function dependentsOf(snapshot: SchemaSnapshot, target: TargetRef): TargetRef[] {
  if (target.kind !== "collection") return [];
  const pick = (kind: TargetRef["kind"], entities: Record<string, EntitySnapshot>) =>
    Object.keys(entities)
      .toSorted(compareCodePoints)
      .filter((slug) => !(kind === "collection" && slug === target.slug))
      .filter((slug) => relatesTo(entities[slug] as EntitySnapshot, target.slug))
      .map((slug): TargetRef => ({ kind, slug }));
  return [
    ...pick("collection", snapshot.collections),
    ...pick("global", snapshot.globals),
  ];
}

/**
 * Computes what a driver needs to run one migration from the state it starts in.
 * @param before - The state just before the migration.
 * @param file - The migration.
 * @param checksum - Its checksum.
 * @returns The plan input: every op with its effect and dependents, and the states around it.
 * @throws {ReplayError} If the migration does not apply to `before`, or leaves a dangling relation.
 */
export function planMigration(
  before: ReplayState,
  file: MigrationFile,
  checksum: string,
): PlannedMigration {
  const { state: after, effects } = applyMigration(before, file.ops);
  let running = before;
  const ops = file.ops.map((op: MigrationOp, i): PlannedOp => {
    const dependents = dependentsOf(running.snapshot, op.target);
    running = applyOp(running, op).state;
    return { op, effect: effects[i], dependents };
  });
  return { id: file.id, checksum, ops, before, after };
}

/**
 * The order the database really has: the journal's (in order of start), then what is still pending
 * in chain order.
 * @param chain - The linear chain.
 * @param applied - The journal.
 * @returns The migrations in real application order. Journal entries unknown to the chain are skipped.
 */
export function realOrderOf(
  chain: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationFile[] {
  const byId = new Map(chain.map((file) => [file.id, file]));
  const journaled = applied.flatMap((entry) => byId.get(entry.id) ?? []);
  const seen = new Set(journaled.map((file) => file.id));
  return [...journaled, ...chain.filter((file) => !seen.has(file.id))];
}

/**
 * Plans the target migrations in sequence, each starting from the state the previous ones in
 * `order` leave (so a migration applied out of chain order is planned over the real schema).
 * @param order - Every migration in real application order.
 * @param checksums - Checksum of each migration.
 * @param targets - The ids to plan (running and pending ones).
 * @returns One plan input per target, in `order`.
 */
export function planSequence(
  order: readonly MigrationFile[],
  checksums: ReadonlyMap<MigrationId, string>,
  targets: ReadonlySet<MigrationId>,
): PlannedMigration[] {
  const planned: PlannedMigration[] = [];
  let state = EMPTY_STATE;
  for (const file of order) {
    if (targets.has(file.id)) {
      const item = planMigration(state, file, checksums.get(file.id) as string);
      planned.push(item);
      state = item.after;
    } else {
      state = applyMigration(state, file.ops).state;
    }
  }
  return planned;
}
