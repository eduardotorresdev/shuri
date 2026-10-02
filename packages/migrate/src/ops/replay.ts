import { ReplayError, type ReplayErrorReason } from "../errors.js";
import { checkIntegrity, integrityIssues } from "../schema/integrity.js";
import { createEntity, dropEntity, renameEntity } from "./apply-entity.js";
import { addField, alterField, dropField, renameField, setIndex } from "./apply-field.js";
import type { OpEffect } from "./apply-shared.js";
import { EMPTY_STATE, type ReplayState } from "./state.js";
import type { MigrationOp } from "./types.js";

export { ReplayError, checkIntegrity };
export type { OpEffect, ReplayErrorReason };

export interface OpResult {
  state: ReplayState;
  effect: OpEffect;
}

// Applies one op to `state` in place. `state` must be a private copy.
function applyInPlace(state: ReplayState, op: MigrationOp): OpEffect {
  switch (op.op) {
    case "createEntity":
      return createEntity(state, op);
    case "dropEntity":
      return dropEntity(state, op);
    case "renameEntity":
      return renameEntity(state, op);
    case "addField":
      return addField(state, op);
    case "dropField":
      return dropField(state, op);
    case "renameField":
      return renameField(state, op);
    case "alterField":
      return alterField(state, op);
    case "setIndex":
      return setIndex(state, op);
  }
}

/**
 * Applies one op with `ensure` semantics: an op whose target state already holds is a no-op.
 * Pure: the input state is never mutated. Referential integrity is NOT checked here, only at the
 * end of a migration (`applyMigration`), so mutually-referencing entities can be created in any order.
 * @param state - The state to apply to.
 * @param op - The op.
 * @returns The new state and whether the op changed anything.
 * @throws {ReplayError} When the op contradicts the state.
 */
export function applyOp(state: ReplayState, op: MigrationOp): OpResult {
  const next = structuredClone(state);
  const effect = applyInPlace(next, op);
  return { state: effect === "noop" ? state : next, effect };
}

/**
 * Applies a migration's ops in order, then checks referential integrity once.
 * @param state - The state to apply to.
 * @param ops - The migration's ops.
 * @returns The new state and each op's effect.
 * @throws {ReplayError} When an op fails, or the final state has a dangling relation or an indexed global.
 */
export function applyMigration(
  state: ReplayState,
  ops: readonly MigrationOp[],
): { state: ReplayState; effects: OpEffect[] } {
  const next = structuredClone(state);
  const effects = ops.map((op) => applyInPlace(next, op));
  const last = ops.at(-1);
  if (last) {
    const issues = integrityIssues(next.snapshot);
    const [first] = issues;
    if (first) {
      throw new ReplayError(
        last,
        first.reason,
        issues.map((issue) => issue.message).join("; "),
        issues.map((issue) => issue.message),
      );
    }
  }
  return { state: next, effects };
}

/**
 * Folds migrations over a starting state.
 * @param migrations - Migrations in application order.
 * @param base - The starting state (default: empty).
 * @returns The resulting state.
 * @throws {ReplayError} As `applyMigration`.
 */
export function replay(
  migrations: Iterable<{ ops: readonly MigrationOp[] }>,
  base: ReplayState = EMPTY_STATE,
): ReplayState {
  let state = base;
  for (const migration of migrations) state = applyMigration(state, migration.ops).state;
  return state;
}
