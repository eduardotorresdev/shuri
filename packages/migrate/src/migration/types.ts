import type { MigrationOp } from "../ops/types.js";

/** The on-disk format version of a migration file. */
export const MIGRATION_FORMAT = 1;

export type MigrationId = string;

/** `YYYYMMDDTHHMMSSmmmZ_<4 hex>_<name>`: lexical order follows creation time. */
export const MIGRATION_ID_PATTERN = /^\d{8}T\d{9}Z_[0-9a-f]{4}_[a-z0-9_]{1,64}$/;

export interface MigrationFile {
  format: typeof MIGRATION_FORMAT;
  id: MigrationId;
  /** The previous migration in the chain; `null` for the first. */
  parent: MigrationId | null;
  ops: MigrationOp[];
}
