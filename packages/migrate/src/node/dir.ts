import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MigrationFileError } from "../errors.js";
import { compareIds } from "../migration/id.js";
import { parseMigration } from "../migration/validator.js";
import { serializeMigration } from "../migration/serialize.js";
import type { MigrationFile } from "../migration/types.js";
import { MigrationsDirError } from "./errors.js";

/** Where migration files live. */
export interface MigrationsDir {
  /** Every migration in the directory, ordered by id. A missing directory is an empty list. */
  list(): Promise<MigrationFile[]>;
  /** Writes (or overwrites) `<id>.json`, creating the directory if needed. */
  write(file: MigrationFile): Promise<void>;
}

async function readNames(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readOne(path: string, name: string): Promise<MigrationFile> {
  const source = join(path, name);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(source, "utf8"));
  } catch (error) {
    throw new MigrationFileError(source, [
      { path: "", message: `is not valid JSON: ${(error as Error).message}` },
    ]);
  }
  return parseMigration(json, source);
}

/**
 * @param path - The migrations directory.
 * @returns A `MigrationsDir` backed by the filesystem. Only `*.json` files are migrations (the
 *   generated `index.ts` and anything else is ignored).
 */
export function fsMigrationsDir(path: string): MigrationsDir {
  return {
    async list() {
      const names = (await readNames(path)).filter((name) => name.endsWith(".json"));
      const results = await Promise.allSettled(names.map((name) => readOne(path, name)));
      const files: MigrationFile[] = [];
      const errors: MigrationFileError[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") files.push(result.value);
        else if (result.reason instanceof MigrationFileError) errors.push(result.reason);
        else throw result.reason;
      }
      // Reported in a stable order whatever the readdir order is.
      if (errors.length > 0) {
        throw new MigrationsDirError(
          path,
          errors.toSorted((a, b) => compareIds(a.source, b.source)),
        );
      }
      return files.toSorted((a, b) => compareIds(a.id, b.id));
    },
    async write(file) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, `${file.id}.json`), serializeMigration(file), "utf8");
    },
  };
}
