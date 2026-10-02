import type { CollectionSchema } from "@shuri/core";
import type { MigrationFile } from "../migration/types.js";
import { migrateUp, type MigrateUpResult } from "../runner/up.js";
import type { ContractRow, ContractWorld } from "./types.js";

/**
 * Runs the pending part of `files` on the world's driver, approving every destructive op.
 * @param world - The driver under test.
 * @param files - The whole chain.
 * @returns What `migrateUp` returned.
 */
export function up(
  world: ContractWorld,
  files: readonly MigrationFile[],
): Promise<MigrateUpResult> {
  return migrateUp({
    files,
    driver: world.adapter.migrations,
    allowDestructive: "all",
  });
}

/**
 * @param rows - Stored rows.
 * @returns The rows without their `id`, in the order read.
 */
export const withoutIds = (rows: readonly ContractRow[]): Record<string, unknown>[] =>
  rows.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    delete copy.id;
    return copy;
  });

/**
 * @param world - The driver under test.
 * @param c - A collection.
 * @returns Its rows without ids.
 */
export async function rowsOf(
  world: ContractWorld,
  c: CollectionSchema,
): Promise<Record<string, unknown>[]> {
  return withoutIds(await world.adapter.findMany(c));
}
