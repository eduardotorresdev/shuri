import type { ResolvedSchema } from "@shuri/core";
import type { MigrationDriver } from "../driver/types.js";
import type { MigrationsDir } from "./dir.js";
import type { MigrateConfig } from "./config.js";

export interface CliIO {
  stdout(s: string): void;
  stderr(s: string): void;
  cwd: string;
  isTTY: boolean;
  /** Asks a yes/no question; only called when `isTTY`. */
  prompt?(question: string): Promise<boolean>;
}

/** Seams for tests; the defaults are the real clock, randomness and config loader. */
export interface CliDeps {
  loadConfig?: (path: string) => Promise<MigrateConfig>;
  now?: () => Date;
  random4hex?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

/** What a command produced: the text for humans and the data for `--json`. */
export interface Outcome {
  /** Exit code; default 0. A non-zero code with an outcome (not an error) is e.g. `status --exit-code`. */
  exit?: number;
  text: string;
  result?: unknown;
}

/** Everything a command needs from the loaded config. */
export interface Project {
  config: MigrateConfig;
  /** Absolute path of the migrations directory. */
  dirPath: string;
  /** Absolute path of the generated bundle. */
  bundleOut: string;
  dir: MigrationsDir;
  schema(): Promise<ResolvedSchema>;
  /** @throws {CliError} If the config has no adapter or it has no `migrations` driver. */
  driver(): Promise<MigrationDriver>;
  /** The driver if the config has a migratable adapter; `undefined` otherwise. */
  optionalDriver(): Promise<MigrationDriver | undefined>;
  /** Ids frozen by `frozenRef`; `undefined` when the config has none. */
  frozen(): Promise<Set<string> | undefined>;
}

export type OptionValue = string | boolean | (string | boolean)[] | undefined;

export interface Env {
  io: CliIO;
  deps: CliDeps;
  values: Record<string, OptionValue>;
  positionals: string[];
  project(): Promise<Project>;
  now(): Date;
  random4hex(): string;
}
