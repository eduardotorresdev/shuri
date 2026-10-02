import { dirname, join, resolve } from "node:path";
import { isMigratable } from "../driver/types.js";
import { DEFAULT_CONFIG_FILE, loadConfig } from "./config.js";
import { fsMigrationsDir } from "./dir.js";
import { CliError } from "./errors.js";
import { frozenIdsAt } from "./git.js";
import type { CliDeps, CliIO, Project } from "./types.js";

/**
 * Loads the config and resolves every path it implies.
 * @param io - Where relative paths start (`cwd`).
 * @param deps - Test seams (config loader).
 * @param flags - `--config` and `--dir`, relative to the working directory.
 * @returns The project; the schema, adapter and git are only touched when asked for.
 * @throws {MigrateConfigError} If the config cannot be loaded.
 */
export async function openProject(
  io: CliIO,
  deps: CliDeps,
  flags: { config?: string; dir?: string },
): Promise<Project> {
  const configPath = resolve(io.cwd, flags.config ?? DEFAULT_CONFIG_FILE);
  const configDir = dirname(configPath);
  const config = await (deps.loadConfig ?? loadConfig)(configPath);
  const dirPath = flags.dir
    ? resolve(io.cwd, flags.dir)
    : resolve(configDir, config.dir ?? "migrations");
  const bundleOut = config.bundle?.out
    ? resolve(configDir, config.bundle.out)
    : join(dirPath, "index.ts");

  let adapter: Promise<object> | undefined;
  const adapterOf = () => (adapter ??= Promise.resolve(config.adapter?.() as object));

  const optionalDriver = async () => {
    if (!config.adapter) return undefined;
    const value = await adapterOf();
    return isMigratable(value) ? value.migrations : undefined;
  };

  return {
    config,
    dirPath,
    bundleOut,
    dir: fsMigrationsDir(dirPath),
    schema: async () => config.schema(),
    optionalDriver,
    async driver() {
      if (!config.adapter) {
        throw new CliError(
          "this command needs a database but the config has no `adapter`",
          "add `adapter: () => <store adapter>` to shuri.migrate.ts",
        );
      }
      const driver = await optionalDriver();
      if (!driver) {
        throw new CliError(
          "the configured adapter has no `migrations` driver",
          "use an adapter that exposes `adapter.migrations` (e.g. @shuri/store-memory)",
        );
      }
      return driver;
    },
    async frozen() {
      return config.frozenRef ? frozenIdsAt(config.frozenRef, dirPath) : undefined;
    },
  };
}
