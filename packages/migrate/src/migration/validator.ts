import {
  all,
  arrayOf,
  matches,
  nullable,
  objectOf,
  oneOf,
  string,
  validate,
  type Validator,
} from "@shuri/validate";
import { MigrationFileError } from "../errors.js";
import { migrationOpValidator } from "../ops/validator.js";
import { unknownKey } from "../schema/validator.js";
import { MIGRATION_FORMAT, MIGRATION_ID_PATTERN, type MigrationFile } from "./types.js";

const idValidator: Validator<unknown> = all(
  string("must be a string"),
  matches(MIGRATION_ID_PATTERN, `must match ${MIGRATION_ID_PATTERN}`),
);

/** Structure of a migration file; the ops are checked with `migrationOpValidator`. */
export const migrationFileValidator: Validator<unknown> = objectOf<
  Record<string, unknown>
>(
  {
    format: oneOf<unknown>([MIGRATION_FORMAT]),
    id: idValidator,
    parent: nullable(idValidator),
    ops: arrayOf(migrationOpValidator, "must be an array", {
      min: 1,
      minMessage: "must have at least one op",
    }),
  },
  "must be an object",
  { unknownKeyMessage: unknownKey },
);

// The file name without directories and without the `.json` extension.
function stemOf(source: string): string {
  const base = source.slice(
    Math.max(source.lastIndexOf("/"), source.lastIndexOf("\\")) + 1,
  );
  return base.endsWith(".json") ? base.slice(0, -".json".length) : base;
}

/**
 * Validates parsed JSON as a migration file and checks that its `id` is the file's name.
 * @param json - The parsed content of the file.
 * @param source - Where it came from (a path); its base name, minus `.json`, must equal `id`.
 * @returns The same data, typed.
 * @throws {MigrationFileError} With every issue found.
 */
export function parseMigration(json: unknown, source: string): MigrationFile {
  const issues = validate(json, migrationFileValidator);
  if (issues.length === 0) {
    const { id } = json as MigrationFile;
    if (id !== stemOf(source)) {
      issues.push({
        path: "id",
        message: `must equal the file name "${stemOf(source)}"`,
      });
    }
  }
  if (issues.length > 0) throw new MigrationFileError(source, issues);
  return json as MigrationFile;
}
