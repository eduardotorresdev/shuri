import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { MigrationId } from "../migration/types.js";
import { GitRefError } from "./errors.js";

const run = promisify(execFile);

/**
 * The migrations that already exist at a git ref (e.g. `origin/main`): those must never be rebased.
 * @param ref - The ref to read, as `git ls-tree` understands it.
 * @param dirPath - Absolute path of the migrations directory (inside the repository).
 * @returns The ids of the `*.json` files the ref has in that directory (none if it has no such directory).
 * @throws {GitRefError} If git is missing, the directory is not in a repository, or the ref does not exist.
 */
export async function frozenIdsAt(
  ref: string,
  dirPath: string,
): Promise<Set<MigrationId>> {
  // A directory that does not exist yet has nothing to freeze.
  if (
    !(await stat(dirPath).then(
      (s) => s.isDirectory(),
      () => false,
    ))
  )
    return new Set();
  try {
    // Run from the migrations directory itself: ls-tree paths are relative to the cwd, and a
    // directory missing in the ref simply lists nothing.
    const { stdout } = await run("git", ["ls-tree", "--name-only", ref, "./"], {
      cwd: dirPath,
    });
    return new Set(
      stdout
        .split("\n")
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length)),
    );
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || String(error);
    throw new GitRefError(ref, detail);
  }
}
