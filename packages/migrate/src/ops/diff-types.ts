import type { MigrationOp, TargetRef } from "./types.js";

export interface DiffWarning {
  kind: "possible-rename";
  target: TargetRef;
  /** A field dropped in this diff... */
  dropped: string;
  /** ...and one added with the same shape: probably a rename that needs a hint. */
  added: string;
}

export interface DiffResult {
  ops: MigrationOp[];
  warnings: DiffWarning[];
}
