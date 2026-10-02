import { parseMigration } from "./validator.js";
import type { MigrationFile } from "./types.js";

/**
 * Validates the default export of a generated `migrations/index.ts` (JSON modules are typed loosely
 * by TypeScript, and a bundle can be stale or hand-edited) and gives it the `MigrationFile` type.
 * @param bundle - The bundle's default export.
 * @returns The migrations, typed, in the order given.
 * @throws {MigrationFileError} For the first entry that is not a valid migration.
 */
export function parseBundle(bundle: readonly unknown[]): MigrationFile[] {
  return bundle.map((entry, index) => {
    const id = (entry as { id?: unknown } | null)?.id;
    return parseMigration(
      entry,
      typeof id === "string" ? `${id}.json` : `bundle[${index}]`,
    );
  });
}
