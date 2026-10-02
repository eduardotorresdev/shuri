import type { MigrationFile } from "./types.js";

/**
 * The exact bytes written to `migrations/<id>.json`: top-level keys in the fixed order
 * `format, id, parent, ops`, two-space indentation, trailing newline. The fixed order keeps a
 * rebase (which only changes `parent`) a one-line diff.
 * @param m - The migration.
 * @returns The file content.
 */
export function serializeMigration(m: MigrationFile): string {
  const ordered = { format: m.format, id: m.id, parent: m.parent, ops: m.ops };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
