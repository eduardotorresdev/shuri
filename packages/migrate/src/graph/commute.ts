import { ReplayError } from "../errors.js";
import type { MigrationFile, MigrationId } from "../migration/types.js";
import { collidingResources, footprint } from "../ops/footprint.js";
import { replay } from "../ops/replay.js";
import { statesEquivalent, type ReplayState } from "../ops/state.js";
import type { MigrationOp } from "../ops/types.js";

/** An op together with where it lives. */
export interface OpRef {
  migration: MigrationId;
  /** Position of the op inside its migration. */
  index: number;
  op: MigrationOp;
}

/** Two ops, one per branch, that touch the same schema resource. */
export interface OpConflict {
  a: OpRef;
  b: OpRef;
  /** A footprint key, e.g. `f:collection:services.price`. */
  resource: string;
}

export type CommuteResult =
  | { commutes: true }
  | {
      commutes: false;
      reason: "replay-error";
      /** The order that failed: `AB` = branch a first, then b. */
      order: "AB" | "BA";
      error: ReplayError;
      conflicts: OpConflict[];
    }
  | { commutes: false; reason: "divergent"; conflicts: OpConflict[] };

function refsOf(files: readonly MigrationFile[]): OpRef[] {
  return files.flatMap((file) =>
    file.ops.map((op, index) => ({ migration: file.id, index, op })),
  );
}

/**
 * @param a - One group of migrations.
 * @param b - Another group.
 * @returns The op pairs (one from each group) whose footprints collide. It only labels a conflict;
 *   whether there is one is decided by replaying.
 */
export function conflictsBetween(
  a: readonly MigrationFile[],
  b: readonly MigrationFile[],
): OpConflict[] {
  const bRefs = refsOf(b).map((ref) => ({ ref, print: footprint(ref.op) }));
  const found: OpConflict[] = [];
  for (const left of refsOf(a)) {
    const leftPrint = footprint(left.op);
    for (const right of bRefs) {
      for (const resource of collidingResources(leftPrint, right.print)) {
        found.push({ a: left, b: right.ref, resource });
      }
    }
  }
  return found;
}

function failureOf(
  base: ReplayState,
  first: readonly MigrationFile[],
  second: readonly MigrationFile[],
): { state: ReplayState } | { error: ReplayError } {
  try {
    return { state: replay([...first, ...second], base) };
  } catch (error) {
    if (error instanceof ReplayError) return { error };
    throw error;
  }
}

/**
 * Decides whether two parallel branches can be applied one after the other in either order. The
 * decision is made by replaying both orders over the whole branches; footprints are only used to
 * label the conflict.
 * @param base - The state at the fork point.
 * @param a - One branch, in application order.
 * @param b - The other branch, in application order.
 * @returns `commutes: true` when neither order fails and both end in equivalent states (same schema
 *   and same lineage); otherwise why not, with the op pairs that touch the same resources.
 */
export function branchesCommute(
  base: ReplayState,
  a: readonly MigrationFile[],
  b: readonly MigrationFile[],
): CommuteResult {
  const ab = failureOf(base, a, b);
  const ba = failureOf(base, b, a);
  const failed =
    "error" in ab
      ? { order: "AB" as const, error: ab.error }
      : "error" in ba
        ? { order: "BA" as const, error: ba.error }
        : undefined;
  if (failed) {
    return {
      commutes: false,
      reason: "replay-error",
      ...failed,
      conflicts: conflictsBetween(a, b),
    };
  }
  if ("state" in ab && "state" in ba && statesEquivalent(ab.state, ba.state)) {
    return { commutes: true };
  }
  return { commutes: false, reason: "divergent", conflicts: conflictsBetween(a, b) };
}
