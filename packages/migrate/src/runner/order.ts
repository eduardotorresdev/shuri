import { ReplayError } from "../errors.js";
import { OutOfOrderConflictError } from "../errors/runner.js";
import { conflictsBetween } from "../graph/commute.js";
import type { MigrationFile } from "../migration/types.js";
import { replay } from "../ops/replay.js";
import { statesEquivalent } from "../ops/state.js";

/**
 * Splits the real order into the migrations that ran after something that comes later in the chain
 * (`late`) and the migrations they ran after (`overtaken`).
 * @param chain - The linear chain.
 * @param order - The real application order (a permutation of the chain).
 * @returns Both groups, in chain order.
 */
export function lateMigrations(
  chain: readonly MigrationFile[],
  order: readonly MigrationFile[],
): { late: MigrationFile[]; overtaken: MigrationFile[] } {
  const position = new Map(chain.map((file, i) => [file.id, i]));
  const at = (file: MigrationFile) => position.get(file.id) as number;
  const late = new Set<MigrationFile>();
  const overtaken = new Set<MigrationFile>();
  order.forEach((file, i) => {
    for (const earlier of order.slice(0, i)) {
      if (at(earlier) > at(file)) {
        late.add(file);
        overtaken.add(earlier);
      }
    }
  });
  const inChain = (set: Set<MigrationFile>) => chain.filter((file) => set.has(file));
  return { late: inChain(late), overtaken: inChain(overtaken) };
}

/**
 * Checks that the order the database really has ends in the same schema (with the same lineage) as
 * the chain, i.e. that running a pending migration after later ones is safe.
 * @param chain - The linear chain.
 * @param order - The real application order.
 * @returns `undefined` when the orders agree; otherwise the error describing the clash.
 * @throws {ReplayError} If the chain itself does not replay.
 */
export function findOrderConflict(
  chain: readonly MigrationFile[],
  order: readonly MigrationFile[],
): OutOfOrderConflictError | undefined {
  const expected = replay(chain);
  const { late, overtaken } = lateMigrations(chain, order);
  const ids = late.map((file) => file.id);
  const conflicts = conflictsBetween(late, overtaken);
  try {
    if (statesEquivalent(replay(order), expected)) return undefined;
  } catch (error) {
    if (!(error instanceof ReplayError)) throw error;
    return new OutOfOrderConflictError(ids, {
      commutes: false,
      reason: "replay-error",
      order: "BA",
      error,
      conflicts,
    });
  }
  return new OutOfOrderConflictError(ids, {
    commutes: false,
    reason: "divergent",
    conflicts,
  });
}
