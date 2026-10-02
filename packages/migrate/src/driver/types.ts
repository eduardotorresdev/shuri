import type { Issue } from "@shuri/validate";
import type { MigrationId } from "../migration/types.js";
import type { OpEffect } from "../ops/apply-shared.js";
import type { ReplayState } from "../ops/state.js";
import type { MigrationOp, TargetRef } from "../ops/types.js";
import type { SchemaSnapshot } from "../schema/snapshot.js";

/** One line of the journal: a migration a database has started or finished. */
export interface AppliedMigration {
  id: MigrationId;
  checksum: string;
  /** `running`: started and not finished (only non-atomic drivers leave this behind after a crash). */
  status: "running" | "done";
  /** ISO timestamp. */
  startedAt: string;
  /** ISO timestamp; set once `status` is `done`. */
  finishedAt?: string;
}

export interface PlannedOp {
  op: MigrationOp;
  /** `noop` ops are already satisfied by the state the migration starts from: a driver skips them. */
  effect: OpEffect;
  /** Entities with a relation to this op's target, as of just before the op (for FKs/junctions). */
  dependents: TargetRef[];
}

export interface PlannedMigration {
  id: MigrationId;
  checksum: string;
  ops: PlannedOp[];
  /** Schema state before and after the migration, in the database's REAL application order. */
  before: ReplayState;
  after: ReplayState;
}

export interface DriverStep {
  description: string;
  destructive: boolean;
  /** Statements the step runs, for engines that have a textual form (SQL). */
  statements?: string[];
  estimatedRows?: number;
}

export interface DriverPlan {
  migration: PlannedMigration;
  steps: DriverStep[];
}

export interface DriverCapabilities {
  /**
   * What a failure halfway leaves behind: `migration` = nothing (all or nothing), `op` = whole ops
   * only, `none` = a part of an op may have happened.
   */
  atomicity: "migration" | "op" | "none";
  /** The journal entry is written in the same atomic unit as the ops. */
  transactionalJournal: boolean;
  /** `render` can turn a plan into text (SQL). */
  render: boolean;
}

/** A held migration lock. */
export interface MigrationLock {
  readonly holder: string;
  /** Extends the TTL. @throws {LockLostError} If another holder took the lock. */
  heartbeat(): Promise<void>;
  /** Fencing: call before every op and before the journal write. @throws {LockLostError} As above. */
  assertHeld(): Promise<void>;
  /** Releases the lock, only if `holder` still owns it. */
  release(): Promise<void>;
}

export interface LockInfo {
  holder: string;
  /** ISO timestamp. */
  expiresAt: string;
}

export interface MigrationDriver {
  readonly capabilities: DriverCapabilities;
  /** Non-fatal problems with how the driver is configured (e.g. a setting that fights migrations); `check` prints them. */
  warnings?(): string[];
  /** Limits of the engine (e.g. columns per table) the snapshot must respect. */
  validateSnapshot?(snapshot: SchemaSnapshot): Issue[];
  /**
   * @param holder - Who is asking.
   * @param ttlMs - How long the lock lives without a heartbeat.
   * @param now - Clock (injectable for tests).
   * @returns The lock, or `undefined` when someone else holds an unexpired one. An expired lock is taken.
   */
  acquireLock(
    holder: string,
    ttlMs: number,
    now?: () => Date,
  ): Promise<MigrationLock | undefined>;
  /** @returns Who holds the lock (even if expired), or `undefined` when it is free. */
  lockInfo(): Promise<LockInfo | undefined>;
  /** Releases the lock whoever holds it. @returns The previous holder, if there was one. */
  forceUnlock(): Promise<LockInfo | undefined>;
  /** @returns The journal, in order of start. */
  applied(): Promise<AppliedMigration[]>;
  plan(m: PlannedMigration): Promise<DriverPlan>;
  /**
   * Runs the plan's ops with `effect: "applied"` and records the journal. Atomic drivers do it in
   * one unit. Others write the journal as `running` first, assert the lock before each op, run
   * idempotent ops, and write `done` last; re-running a `running` migration re-executes all its ops.
   */
  execute(plan: DriverPlan, lock: MigrationLock): Promise<void>;
  render?(plan: DriverPlan): string;
  journal: {
    /** Records a migration as done without running it (baseline / mark-applied). */
    markApplied(entry: Pick<AppliedMigration, "id" | "checksum">): Promise<void>;
    unmark(id: MigrationId): Promise<void>;
    setChecksum(id: MigrationId, checksum: string): Promise<void>;
  };
}

/** What an adapter exposes when it supports migrations. */
export interface Migratable {
  readonly migrations: MigrationDriver;
}

/**
 * @param value - Anything, typically a store adapter.
 * @returns Whether it has a `migrations` driver.
 */
export function isMigratable(value: object): value is Migratable {
  const driver = (value as { migrations?: unknown }).migrations;
  if (typeof driver !== "object" || driver === null) return false;
  const d = driver as Record<string, unknown>;
  return (
    typeof d.acquireLock === "function" &&
    typeof d.applied === "function" &&
    typeof d.plan === "function" &&
    typeof d.execute === "function" &&
    typeof d.journal === "object" &&
    d.journal !== null
  );
}
