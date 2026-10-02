import { formatIssues, type Issue } from "@shuri/validate";
import { describeOp } from "../graph/format-conflict.js";
import type { CommuteResult } from "../graph/commute.js";
import type { MigrationId } from "../migration/types.js";
import type { MigrationOp, TargetRef } from "../ops/types.js";

/** Thrown when the schema in code is not what the migrations produce. */
export class SchemaDriftError extends Error {
  /** The ops that would take the migrations' schema to the code's. */
  readonly ops: readonly MigrationOp[];

  constructor(ops: readonly MigrationOp[]) {
    super(
      `the schema in code differs from the migrations (${ops.length} change${ops.length === 1 ? "" : "s"}: ` +
        `${ops.map(describeOp).join("; ")}); run \`shuri-migrate generate <name>\``,
    );
    this.name = "SchemaDriftError";
    this.ops = ops;
  }
}

/** Thrown by `assertMigrated` when the database is behind the migrations. */
export class PendingMigrationsError extends Error {
  readonly pending: readonly MigrationId[];
  readonly running: readonly MigrationId[];

  constructor(pending: readonly MigrationId[], running: readonly MigrationId[]) {
    const parts = [
      pending.length > 0 ? `pending: ${pending.join(", ")}` : "",
      running.length > 0 ? `interrupted: ${running.join(", ")}` : "",
    ].filter(Boolean);
    super(`the database is not migrated (${parts.join("; ")}); run \`shuri-migrate up\``);
    this.name = "PendingMigrationsError";
    this.pending = pending;
    this.running = running;
  }
}

/** Thrown when the migrated schema does not fit the engine (see `MigrationDriver.validateSnapshot`). */
export class DriverLimitError extends Error {
  readonly issues: readonly Issue[];

  constructor(issues: readonly Issue[]) {
    super(
      `the schema exceeds the database limits: ${formatIssues([...issues])}; ` +
        "change the schema and run `shuri-migrate generate <name>`",
    );
    this.name = "DriverLimitError";
    this.issues = issues;
  }
}

/** Thrown when another process holds the migration lock. */
export class MigrationLockedError extends Error {
  readonly holder: string;
  readonly expiresAt: string;

  constructor(holder: string, expiresAt: string) {
    super(
      `migrations are locked by ${holder} until ${expiresAt}; wait, or run ` +
        "`shuri-migrate unlock --force` if that process is gone",
    );
    this.name = "MigrationLockedError";
    this.holder = holder;
    this.expiresAt = expiresAt;
  }
}

/** Thrown when this process finds that its lock was taken over (it expired and someone else got it). */
export class LockLostError extends Error {
  readonly holder: string;

  constructor(holder: string) {
    super(
      `the migration lock held by ${holder} was lost; check the database with ` +
        "`shuri-migrate status`, then run `shuri-migrate up` again",
    );
    this.name = "LockLostError";
    this.holder = holder;
  }
}

/** Thrown before applying anything when a pending migration destroys data and was not approved. */
export class DestructiveMigrationError extends Error {
  readonly items: readonly { migration: MigrationId; op: MigrationOp }[];

  constructor(items: readonly { migration: MigrationId; op: MigrationOp }[]) {
    const ids = [...new Set(items.map((item) => item.migration))];
    super(
      `destructive operations need approval: ${items
        .map((item) => `${item.migration}: ${describeOp(item.op)}`)
        .join(
          "; ",
        )}; review them, then run \`shuri-migrate up --allow-destructive ${ids.join(",")}\``,
    );
    this.name = "DestructiveMigrationError";
    this.items = items;
  }
}

/** Thrown when a migration was edited after it ran in the database. */
export class ChecksumMismatchError extends Error {
  readonly ids: readonly MigrationId[];

  constructor(ids: readonly MigrationId[]) {
    super(
      `migrations changed after they were applied: ${ids.join(", ")}; restore the files, or run ` +
        `\`shuri-migrate repair-checksum ${ids[0]}\` if the edit was intended`,
    );
    this.name = "ChecksumMismatchError";
    this.ids = ids;
  }
}

/** Thrown when the database ran a migration the files do not have. */
export class UnknownAppliedMigrationError extends Error {
  readonly ids: readonly MigrationId[];

  constructor(ids: readonly MigrationId[]) {
    super(
      `the database applied migrations that are not in the migrations folder: ${ids.join(", ")}; ` +
        "restore the files (git pull?), or run `shuri-migrate unmark <id>`",
    );
    this.name = "UnknownAppliedMigrationError";
    this.ids = ids;
  }
}

/**
 * Thrown when pending migrations that sit before applied ones in the chain cannot run after them:
 * the order the database really has is not equivalent to the chain's.
 */
export class OutOfOrderConflictError extends Error {
  /** The pending migrations that precede applied ones in the chain. */
  readonly ids: readonly MigrationId[];
  readonly result: Extract<CommuteResult, { commutes: false }>;

  constructor(
    ids: readonly MigrationId[],
    result: Extract<CommuteResult, { commutes: false }>,
  ) {
    const clashes = [...new Set(result.conflicts.map((c) => c.resource))];
    super(
      `${ids.join(", ")} must run after migrations the database already applied, and the result ` +
        `differs from the chain's${clashes.length > 0 ? ` (${clashes.join(", ")})` : ""}; ` +
        "edit the migration so both orders agree, then run `shuri-migrate status`",
    );
    this.name = "OutOfOrderConflictError";
    this.ids = ids;
    this.result = result;
  }
}

/**
 * Thrown by a driver when a rename would overwrite data: the destination collection or global
 * already holds data, or (for a field rename) documents that already carry the new name.
 */
export class RenameCollisionError extends Error {
  readonly target: TargetRef;
  /** The new name (of the entity) or the new field name. */
  readonly to: string;
  /** A sample of the ids of the colliding records; empty when the collision is a whole entity. */
  readonly sampleIds: readonly string[];

  constructor(target: TargetRef, to: string, sampleIds: readonly string[] = []) {
    const sample = sampleIds.length > 0 ? ` (e.g. ${sampleIds.join(", ")})` : "";
    super(
      `cannot rename ${target.kind} ${target.slug} to ${to}: ${to} already has data${sample}`,
    );
    this.name = "RenameCollisionError";
    this.target = target;
    this.to = to;
    this.sampleIds = sampleIds;
  }
}
