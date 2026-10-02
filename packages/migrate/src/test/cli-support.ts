import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSchema } from "@shuri/core";
import type { MigrationFile } from "../migration/types.js";
import { fsMigrationsDir } from "../node/dir.js";
import { runCli } from "../node/cli.js";
import type { MigrateConfig } from "../node/config.js";
import type { MigrationOp } from "../ops/types.js";
import { snap } from "../ops/test-support.js";
import { createFakeStore, type FakeStore } from "../testing/fake-driver.js";
import { schemaFromSnapshot } from "../testing/schema-from-snapshot.js";
import type { MigrationDriver } from "../driver/types.js";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** `stdout` parsed, when the run was `--json`. */
  json?: {
    version: number;
    command: string;
    ok: boolean;
    result?: Record<string, unknown>;
    error?: { name: string; message: string; details: unknown };
  };
}

export interface RunOptions {
  isTTY?: boolean;
  /** Answers handed to `prompt`, in order. */
  answers?: boolean[];
}

export interface Harness {
  /** The working directory of the CLI (a temp dir). */
  root: string;
  migrationsDir: string;
  store: FakeStore;
  /** What `config.schema()` returns; change it with `setSchema`. */
  setSchema(...ops: MigrationOp[]): void;
  /** Writes migration files into the directory. */
  put(...files: MigrationFile[]): Promise<void>;
  /** Reads them back. */
  files(): Promise<MigrationFile[]>;
  names(): Promise<string[]>;
  read(name: string): Promise<string>;
  /** The questions `prompt` was asked. */
  questions: string[];
  run(args: string[], options?: RunOptions): Promise<CliResult>;
  cleanup(): Promise<void>;
}

export interface HarnessOptions {
  /** Extra config (e.g. `frozenRef`, `bundle`); `adapter: null` removes the adapter. */
  config?: Partial<Omit<MigrateConfig, "adapter">> & { adapter?: null };
  /** Wraps the store's driver (e.g. to add `render`). */
  driver?: (driver: MigrationDriver) => MigrationDriver;
}

/**
 * A temp project with a fake store, driving `runCli` in-process with a deterministic clock and ids.
 * @param options - Config overrides.
 * @returns The harness; call `cleanup()` after the test.
 */
export async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "shuri-migrate-cli-"));
  const migrationsDir = join(root, "migrations");
  const store = createFakeStore();
  let schema: ResolvedSchema = { collections: [], globals: [] };
  let clock = 0;
  let hex = 0;
  const questions: string[] = [];
  const dir = fsMigrationsDir(migrationsDir);

  const adapter = options.driver
    ? { ...store.adapter, migrations: options.driver(store.adapter.migrations) }
    : store.adapter;
  const { adapter: withoutAdapter, ...extra } = options.config ?? {};
  const config: MigrateConfig = {
    schema: () => schema,
    ...extra,
    ...(withoutAdapter === null ? {} : { adapter: () => adapter }),
  };

  return {
    root,
    migrationsDir,
    store,
    questions,
    setSchema(...ops) {
      schema = schemaFromSnapshot(snap(...ops));
    },
    async put(...files) {
      for (const file of files) await dir.write(file);
    },
    files: () => dir.list(),
    names: async () => (await readdir(migrationsDir)).toSorted(),
    read: (name) => readFile(join(migrationsDir, name), "utf8"),
    async run(args, runOptions = {}) {
      const answers = [...(runOptions.answers ?? [])];
      let stdout = "";
      let stderr = "";
      const code = await runCli(
        args,
        {
          stdout: (s) => void (stdout += s),
          stderr: (s) => void (stderr += s),
          cwd: root,
          isTTY: runOptions.isTTY ?? false,
          prompt: async (question) => {
            questions.push(question);
            return answers.shift() ?? false;
          },
        },
        {
          loadConfig: async () => config,
          now: () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000),
          random4hex: () => (hex++).toString(16).padStart(4, "0"),
        },
      );
      const result: CliResult = { code, stdout, stderr };
      if (args.includes("--json")) result.json = JSON.parse(stdout);
      return result;
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
