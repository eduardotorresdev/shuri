import type { MigrationOp } from "../ops/types.js";
import { add, col, text } from "../ops/test-support.js";
import type { MigrationFile, MigrationId } from "./types.js";

// A migration file; `id` must be a valid migration id. Without ops it adds a throwaway field.
export const mig = (
  id: MigrationId,
  parent: MigrationId | null,
  ops: MigrationOp[] = [add(col("posts"), "f", text)],
): MigrationFile => ({ format: 1, id, parent, ops });

// A valid id that sorts by `n`, e.g. `idAt(3, "x")`.
export const idAt = (n: number, name = "step"): MigrationId =>
  `20260101T0000${String(n).padStart(5, "0")}Z_0000_${name}`;
