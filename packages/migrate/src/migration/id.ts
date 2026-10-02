import { InvalidMigrationNameError } from "../errors.js";
import { MIGRATION_ID_PATTERN, type MigrationId } from "./types.js";

const MAX_NAME = 64;

/**
 * Turns free text into the name part of a migration id: lowercase, every run of characters outside
 * `[a-z0-9]` becomes one `_`, no leading/trailing `_`, at most 64 characters.
 * @param input - What the developer typed, e.g. `"Add price to Services"`.
 * @returns The slug, e.g. `"add_price_to_services"`.
 * @throws {InvalidMigrationNameError} If nothing usable remains (empty or only symbols).
 */
export function slugifyName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, MAX_NAME)
    .replace(/_+$/, "");
  if (slug === "") throw new InvalidMigrationNameError(input);
  return slug;
}

/**
 * @param name - Migration name; slugified here.
 * @param now - Creation time (UTC, millisecond precision).
 * @param random4hex - Source of the 4 hex digits that make a collision between devs negligible.
 * @returns The new id, e.g. `20261002T153012000Z_1a2b_add_price`.
 * @throws {InvalidMigrationNameError} If `name` has nothing usable.
 * @throws {TypeError} If `random4hex` does not yield exactly 4 lowercase hex digits.
 */
export function newMigrationId(
  name: string,
  now: Date,
  random4hex: () => string,
): MigrationId {
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  const id = `${stamp}_${random4hex()}_${slugifyName(name)}`;
  if (!MIGRATION_ID_PATTERN.test(id)) {
    throw new TypeError(`random4hex must yield 4 lowercase hex digits (id: ${id})`);
  }
  return id;
}

/**
 * Orders ids by creation time (lexical order of the fixed-width timestamp, then suffix).
 * @param a - Left id.
 * @param b - Right id.
 * @returns Negative, zero or positive, like a sort comparator.
 */
export function compareIds(a: MigrationId, b: MigrationId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
