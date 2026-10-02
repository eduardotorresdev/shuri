import { describe, expect, it } from "vitest";
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
import type { CommuteResult } from "../graph/commute.js";
import { add, col, int } from "../ops/test-support.js";
import { CliError, CliUsageError, MigrationsDirError } from "./errors.js";
import { describeFailure } from "./failure.js";

const op = add(col("posts"), "views", int);
const divergent: Extract<CommuteResult, { commutes: false }> = {
  commutes: false,
  reason: "divergent",
  conflicts: [],
};

// Every error of the plan's table (section 13) with the exit code the CLI must use for it.
const cases: [string, Error, number][] = [
  ["CanonicalJsonError", new CanonicalJsonError("$.a", "bad"), 1],
  [
    "MigrationFileError",
    new MigrationFileError("f.json", [{ path: "x", message: "m" }]),
    1,
  ],
  ["InvalidMigrationNameError", new InvalidMigrationNameError("!!"), 2],
  ["ReplayError", new ReplayError(op, "entity-missing", "no such entity"), 1],
  ["DiffHintError", new DiffHintError({}, "cycle", "d"), 2],
  ["GraphError", new GraphError("cycle", ["a"]), 1],
  ["MultipleHeadsError", new MultipleHeadsError(["a", "b"]), 3],
  ["ReconcileConflictError", new ReconcileConflictError(divergent, [["a"], ["b"]]), 3],
  ["FrozenDivergenceError", new FrozenDivergenceError(["a", "b"]), 3],
  ["SchemaDriftError", new SchemaDriftError([op]), 4],
  ["PendingMigrationsError", new PendingMigrationsError(["a"], []), 4],
  ["DriverLimitError", new DriverLimitError([{ path: "p", message: "m" }]), 1],
  ["MigrationLockedError", new MigrationLockedError("h", "later"), 5],
  ["LockLostError", new LockLostError("h"), 5],
  [
    "DestructiveMigrationError",
    new DestructiveMigrationError([{ migration: "a", op }]),
    6,
  ],
  ["ChecksumMismatchError", new ChecksumMismatchError(["a"]), 7],
  ["UnknownAppliedMigrationError", new UnknownAppliedMigrationError(["a"]), 7],
  ["OutOfOrderConflictError", new OutOfOrderConflictError(["a"], divergent), 3],
  ["MigrationsDirError", new MigrationsDirError("d", []), 1],
];

describe("describeFailure", () => {
  it.each(cases)("%s exits with the code of the error table", (name, error, exit) => {
    const failure = describeFailure(error);
    expect(failure.name).toBe(name);
    expect(failure.exit).toBe(exit);
    expect(failure.next).not.toBe("");
  });

  it("uses the error's own exit code and suggested command for a CliError", () => {
    expect(describeFailure(new CliError("m", "do this", 9))).toMatchObject({
      exit: 9,
      next: "do this",
    });
    expect(describeFailure(new CliUsageError("m"))).toMatchObject({
      exit: 2,
      next: "run `shuri-migrate --help`",
    });
  });

  it("falls back to exit 1 for an unexpected error, and for a thrown non-error", () => {
    expect(describeFailure(new TypeError("x"))).toMatchObject({
      exit: 1,
      name: "TypeError",
      message: "x",
    });
    expect(describeFailure("oops")).toMatchObject({ exit: 1, message: "oops" });
  });

  it("explains a reconcile conflict with the multi-line diagnostic", () => {
    expect(
      describeFailure(new ReconcileConflictError(divergent, [["a"], ["b"]])).message,
    ).toContain("conflict while reconciling");
  });

  it("makes details JSON-safe: nested errors become {name, message}", () => {
    const failure = describeFailure(
      new OutOfOrderConflictError(["a"], {
        commutes: false,
        reason: "replay-error",
        order: "AB",
        error: new ReplayError(op, "entity-missing", "no such entity"),
        conflicts: [],
      }),
    );
    const roundTripped = JSON.parse(JSON.stringify(failure.details));
    expect(roundTripped.ids).toEqual(["a"]);
    expect(roundTripped.result.error).toMatchObject({ name: "ReplayError" });
  });

  it("names the unapproved migrations in the next step for a destructive run", () => {
    const failure = describeFailure(
      new DestructiveMigrationError([
        { migration: "m2", op },
        { migration: "m2", op },
        { migration: "m5", op },
      ]),
    );
    expect(failure.next).toContain("--allow-destructive m2,m5");
  });
});
