import type { ResolvedSchema } from "@shuri/core";
import {
  DestructiveMigrationError,
  DriverLimitError,
  MigrationLockedError,
  SchemaDriftError,
} from "../errors/runner.js";
import type {
  DriverPlan,
  MigrationDriver,
  MigrationLock,
  PlannedMigration,
} from "../driver/types.js";
import type { MigrationId } from "../migration/types.js";
import { isDestructive } from "../ops/conversion.js";
import { replay } from "../ops/replay.js";
import { assertTrustworthy, chainInfoOf, driftOf, inspect } from "./status.js";
import type { MigrationSet } from "./status.js";
import { planSequence } from "./plan.js";

export interface MigrateUpOptions extends MigrationSet {
  driver: MigrationDriver;
  /** The schema in code; when given, `migrateUp` refuses to run if it differs from the migrations. */
  schema?: ResolvedSchema;
  /** Migrations whose destructive ops are approved, or `"all"`. */
  allowDestructive?: readonly MigrationId[] | "all";
  /** Plans every pending migration and returns the plans without executing anything. */
  dryRun?: boolean;
  /** Lock holder name (default: a random UUID). */
  holder?: string;
  /** Lock lifetime without a heartbeat (default 60_000); a heartbeat runs every third of it. */
  lockTtlMs?: number;
  /** How long to wait for a busy lock before giving up (default 0: fail at once). */
  waitForLockMs?: number;
  now?: () => Date;
  /** Waits between lock attempts (injectable for tests; default `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
}

export interface MigrateUpResult {
  /** Ids executed by this call, in order. */
  applied: MigrationId[];
  /** The driver's plans; filled only in `dryRun`. */
  plans: DriverPlan[];
}

const LOCK_POLL_MS = 100;
const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function acquire(o: MigrateUpOptions, holder: string, ttlMs: number) {
  const sleep = o.sleep ?? defaultSleep;
  let waited = 0;
  for (;;) {
    const lock = await o.driver.acquireLock(holder, ttlMs, o.now);
    if (lock) return lock;
    const wait = Math.min(LOCK_POLL_MS, (o.waitForLockMs ?? 0) - waited);
    if (wait <= 0) break;
    await sleep(wait);
    waited += wait;
  }
  const info = await o.driver.lockInfo();
  throw new MigrationLockedError(info?.holder ?? "unknown", info?.expiresAt ?? "unknown");
}

function unapproved(
  planned: readonly PlannedMigration[],
  allow: MigrateUpOptions["allowDestructive"],
) {
  if (allow === "all") return [];
  const approved = new Set(allow ?? []);
  return planned.flatMap((m) =>
    approved.has(m.id)
      ? []
      : m.ops
          .filter((p) => p.effect === "applied" && isDestructive(p.op))
          .map((p) => ({ migration: m.id, op: p.op })),
  );
}

// Keeps the lock alive while `work` runs; a failed heartbeat is raised before the next migration.
async function withHeartbeat<T>(
  lock: MigrationLock,
  ttlMs: number,
  work: (check: () => void) => Promise<T>,
): Promise<T> {
  let failure: unknown;
  const timer = setInterval(
    () => {
      lock.heartbeat().catch((error: unknown) => {
        failure ??= error;
      });
    },
    Math.max(1, Math.floor(ttlMs / 3)),
  );
  try {
    return await work(() => {
      if (failure) throw failure;
    });
  } finally {
    clearInterval(timer);
  }
}

/**
 * Applies the pending (and interrupted) migrations to the database.
 *
 * Order of business: linear chain (several heads is an error) -> schema drift -> driver limits ->
 * lock -> re-read the journal under the lock -> checksums, unknown migrations, out-of-order safety ->
 * plan every target over the REAL order -> destructive approval (before touching anything) ->
 * plan + execute each, with a heartbeat on the lock.
 * @param o - Files, driver and options.
 * @returns The ids applied and, in `dryRun`, the plans.
 * @throws {MultipleHeadsError} Branches not reconciled.
 * @throws {SchemaDriftError} The schema in code is not what the migrations produce.
 * @throws {DriverLimitError} The schema does not fit the engine.
 * @throws {MigrationLockedError} Another process holds the lock.
 * @throws {UnknownAppliedMigrationError} The journal has migrations the files do not.
 * @throws {ChecksumMismatchError} A migration changed after it ran.
 * @throws {OutOfOrderConflictError} A pending migration cannot run after the applied later ones.
 * @throws {DestructiveMigrationError} A destructive op was not approved (not in `dryRun`).
 */
export async function migrateUp(o: MigrateUpOptions): Promise<MigrateUpResult> {
  const { chain } = await chainInfoOf(o.files);
  if (o.schema) {
    const drift = driftOf(chain, o.schema);
    if (drift) throw new SchemaDriftError(drift);
  }
  const issues = o.driver.validateSnapshot?.(replay(chain).snapshot) ?? [];
  if (issues.length > 0) throw new DriverLimitError(issues);

  const ttlMs = o.lockTtlMs ?? 60_000;
  const lock = await acquire(o, o.holder ?? globalThis.crypto.randomUUID(), ttlMs);
  try {
    const inspection = await inspect({ files: o.files, driver: o.driver });
    assertTrustworthy(inspection);
    const { pending, running } = inspection.status;
    const planned = planSequence(
      inspection.order,
      inspection.checksums,
      new Set([...running, ...pending]),
    );
    if (!o.dryRun) {
      const items = unapproved(planned, o.allowDestructive);
      if (items.length > 0) throw new DestructiveMigrationError(items);
    }

    const result: MigrateUpResult = { applied: [], plans: [] };
    await withHeartbeat(lock, ttlMs, async (check) => {
      for (const migration of planned) {
        check();
        const plan = await o.driver.plan(migration);
        if (o.dryRun) {
          result.plans.push(plan);
          continue;
        }
        await o.driver.execute(plan, lock);
        result.applied.push(migration.id);
      }
    });
    return result;
  } finally {
    await lock.release();
  }
}
