import type { MigrationFileError } from "../errors.js";

/** A problem the CLI reports with an exit code and a command to try next. */
export class CliError extends Error {
  readonly exit: number;
  /** The command (or action) that gets the user unstuck; printed last in every message. */
  readonly next: string;

  constructor(message: string, next: string, exit = 1) {
    super(message);
    this.name = "CliError";
    this.exit = exit;
    this.next = next;
  }
}

/** Invalid command line: unknown command, missing argument, malformed flag (exit 2). */
export class CliUsageError extends CliError {
  constructor(message: string) {
    super(message, "run `shuri-migrate --help`", 2);
    this.name = "CliUsageError";
  }
}

/** The config file could not be loaded or has the wrong shape. */
export class MigrateConfigError extends CliError {
  readonly path: string;

  constructor(path: string, message: string, next: string) {
    super(`${path}: ${message}`, next);
    this.name = "MigrateConfigError";
    this.path = path;
  }
}

/** One or more files in the migrations directory are not valid migrations. */
export class MigrationsDirError extends Error {
  readonly dir: string;
  readonly errors: readonly MigrationFileError[];

  constructor(dir: string, errors: readonly MigrationFileError[]) {
    super(
      `${errors.length} invalid migration file(s) in ${dir}:\n${errors
        .map((e) => `  ${e.message.split("\n").join("\n  ")}`)
        .join("\n")}`,
    );
    this.name = "MigrationsDirError";
    this.dir = dir;
    this.errors = errors;
  }
}

/** `git` could not list the frozen ref. */
export class GitRefError extends CliError {
  readonly ref: string;

  constructor(ref: string, detail: string) {
    super(
      `cannot read migrations at git ref "${ref}": ${detail}`,
      "fetch the ref (e.g. `git fetch origin`), fix `frozenRef` in shuri.migrate.ts, or remove it",
    );
    this.name = "GitRefError";
    this.ref = ref;
  }
}
