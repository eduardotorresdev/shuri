import {
  CanonicalJsonError,
  DiffHintError,
  FrozenDivergenceError,
  GraphError,
  InvalidMigrationNameError,
  MigrationFileError,
  MultipleHeadsError,
  ReconcileConflictError,
  ReplayError,
} from "../errors.js";
import {
  ChecksumMismatchError,
  DestructiveMigrationError,
  DriverLimitError,
  LockLostError,
  MigrationLockedError,
  OutOfOrderConflictError,
  PendingMigrationsError,
  SchemaDriftError,
  UnknownAppliedMigrationError,
} from "../errors/runner.js";
import { describeOp } from "../graph/format-conflict.js";
import { CliError, MigrationsDirError } from "./errors.js";

export interface Failure {
  exit: number;
  name: string;
  message: string;
  details: unknown;
  /** The command that gets the user unstuck. */
  next: string;
}

// [class, exit code, next step] in the order of the plan's error table (section 13).
const TABLE: [new (...args: never[]) => Error, number, (e: never) => string][] = [
  [
    InvalidMigrationNameError,
    2,
    () => "pick a name with letters or digits, e.g. `shuri-migrate generate add_price`",
  ],
  [
    DiffHintError,
    2,
    () =>
      "fix the --rename-entity / --rename-field flag, or drop it and re-run `shuri-migrate generate <name>`",
  ],
  [MultipleHeadsError, 3, () => "run `shuri-migrate reconcile`"],
  [
    ReconcileConflictError,
    3,
    () => "edit one of the conflicting files and run `shuri-migrate reconcile`",
  ],
  [
    FrozenDivergenceError,
    3,
    () =>
      "both branches are already in the frozen ref: write a corrective migration by hand, then run `shuri-migrate reconcile`",
  ],
  [
    OutOfOrderConflictError,
    3,
    () =>
      "edit the pending migration so it commutes with the ones already applied, then run `shuri-migrate status`",
  ],
  [
    SchemaDriftError,
    4,
    () => "run `shuri-migrate generate <name>` to record the schema change",
  ],
  [PendingMigrationsError, 4, () => "run `shuri-migrate up`"],
  [
    MigrationLockedError,
    5,
    () => "wait for the holder, or run `shuri-migrate unlock --force` if it crashed",
  ],
  [
    LockLostError,
    5,
    () =>
      "run `shuri-migrate status` to see what was applied, then `shuri-migrate up` again",
  ],
  [
    DestructiveMigrationError,
    6,
    (e: DestructiveMigrationError) =>
      `review the ops, then run \`shuri-migrate up --allow-destructive ${[...new Set(e.items.map((i) => i.migration))].join(",")}\``,
  ],
  [
    ChecksumMismatchError,
    7,
    (e: ChecksumMismatchError) =>
      `restore the file, or if the edit is intended run \`shuri-migrate repair-checksum ${e.ids[0]}\``,
  ],
  [
    UnknownAppliedMigrationError,
    7,
    (e: UnknownAppliedMigrationError) =>
      `restore the missing file(s), or run \`shuri-migrate unmark ${e.ids[0]}\``,
  ],
  [MigrationFileError, 1, () => "fix the file and run `shuri-migrate check`"],
  [MigrationsDirError, 1, () => "fix the files above and run `shuri-migrate check`"],
  [
    ReplayError,
    1,
    () => "fix the migration that does not replay and run `shuri-migrate check`",
  ],
  [
    GraphError,
    1,
    () =>
      "fix the `parent` links (or restore the missing files) and run `shuri-migrate check`",
  ],
  [
    DriverLimitError,
    1,
    () => "change the schema to fit the database, then run `shuri-migrate check`",
  ],
  [
    CanonicalJsonError,
    1,
    () => "fix the value in the migration and run `shuri-migrate check`",
  ],
];

// Errors nest other errors (a conflict carries a ReplayError); JSON needs plain data.
function plain(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (depth > 6 || typeof value === "function") return undefined;
  if (value instanceof Set) return [...value].map((v) => plain(v, depth + 1));
  if (value instanceof Map)
    return Object.fromEntries(
      [...value].map(([k, v]) => [String(k), plain(v, depth + 1)]),
    );
  if (Array.isArray(value)) return value.map((v) => plain(v, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v, depth + 1)]),
    );
  }
  return value;
}

function detailsOf(error: Error): unknown {
  const own = Object.fromEntries(
    Object.entries(error).filter(([key]) => key !== "stack" && key !== "next"),
  );
  if (error instanceof DestructiveMigrationError) {
    return {
      items: error.items.map((i) => ({ migration: i.migration, op: describeOp(i.op) })),
    };
  }
  return plain(own);
}

/**
 * Classifies any error the CLI can meet: its exit code (plan, section 13), a JSON-safe `details`, and the
 * command to suggest next.
 * @param error - Whatever a command threw.
 * @returns The failure to report.
 */
export function describeFailure(error: unknown): Failure {
  if (!(error instanceof Error)) {
    return {
      exit: 1,
      name: "Error",
      message: String(error),
      details: {},
      next: "re-run with a valid setup",
    };
  }
  if (error instanceof CliError) {
    return {
      exit: error.exit,
      name: error.name,
      message: error.message,
      details: detailsOf(error),
      next: error.next,
    };
  }
  const entry = TABLE.find(([cls]) => error instanceof cls);
  const message =
    error instanceof ReconcileConflictError ? error.format() : error.message;
  return {
    exit: entry?.[1] ?? 1,
    name: error.name,
    message,
    details: detailsOf(error),
    next: entry ? entry[2](error as never) : "re-run with a valid setup",
  };
}
