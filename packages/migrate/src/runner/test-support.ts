import type { MigrationDriver, MigrationLock } from "../driver/types.js";
import { idAt, mig } from "../migration/test-support.js";
import { add, col, create, int, text } from "../ops/test-support.js";
import { checksumOf } from "../migration/checksum.js";
import type { MigrationFile } from "../migration/types.js";
import { applyRewrites, planReconcile } from "../graph/reconcile.js";
import { replay } from "../ops/replay.js";
import { createFakeStore, type FakeStoreOptions } from "../testing/fake-driver.js";
import { schemaFromSnapshot } from "../testing/schema-from-snapshot.js";
import { migrateUp, type MigrateUpOptions } from "./up.js";

/**
 * @param options - Atomicity and clock of the fake.
 * @returns A fake store plus its driver, for runner tests.
 */
export function newStore(options?: FakeStoreOptions) {
  const store = createFakeStore(options);
  return { ...store, driver: store.adapter.migrations };
}

/**
 * @param files - A chain.
 * @param driver - The driver to run on.
 * @param extra - More `migrateUp` options.
 * @returns What `migrateUp` returned.
 */
export const run = (
  files: readonly MigrationFile[],
  driver: MigrationDriver,
  extra: Partial<MigrateUpOptions> = {},
) => migrateUp({ files, driver, ...extra });

/**
 * @param files - A chain.
 * @returns The schema the chain produces, as `resolveSchema` would give it.
 */
export const schemaOf = (files: readonly MigrationFile[]) =>
  schemaFromSnapshot(replay(files).snapshot);

/**
 * Records `files` in the journal as applied, with their real checksums, without running them.
 * @param driver - The driver whose journal to write.
 * @param files - The migrations to mark, in the order they "ran".
 */
export async function markAll(
  driver: MigrationDriver,
  files: readonly MigrationFile[],
): Promise<void> {
  for (const file of files) {
    await driver.journal.markApplied({ id: file.id, checksum: await checksumOf(file) });
  }
}

/**
 * @param files - Files with parallel branches.
 * @returns The linear chain after `planReconcile`, with the new parents written in.
 */
export function reconciled(files: readonly MigrationFile[]): MigrationFile[] {
  const plan = planReconcile(files);
  const byId = new Map(applyRewrites(files, plan.rewrites).map((f) => [f.id, f]));
  return plan.chain.map((id) => byId.get(id) as MigrationFile);
}

// A three-migration chain on `posts`, shared by the runner tests.
export const posts = col("posts");
export const m1 = mig(idAt(1, "init"), null, [
  create(posts, { title: text, body: text }),
]);
export const m2 = mig(idAt(2, "views"), m1.id, [add(posts, "views", int)]);
export const m3 = mig(idAt(3, "tags"), m2.id, [add(posts, "tags", text)]);
export const chain = [m1, m2, m3];
export const ids = (files: readonly { id: string }[]) => files.map((f) => f.id);

/**
 * @param driver - The driver to wrap.
 * @param hooks - Code to run before each `execute`, and a way to decorate the lock `acquireLock` returns.
 * @returns A driver that behaves like `driver` but lets a test observe or interfere around `execute`.
 */
export function wrapped(
  driver: MigrationDriver,
  hooks: {
    beforeExecute?: (id: string, lock: MigrationLock) => Promise<void>;
    lockOf?: (lock: MigrationLock) => MigrationLock;
  },
): MigrationDriver {
  return {
    ...driver,
    async acquireLock(...args) {
      const lock = await driver.acquireLock(...args);
      return lock && hooks.lockOf ? hooks.lockOf(lock) : lock;
    },
    async execute(plan, lock) {
      await hooks.beforeExecute?.(plan.migration.id, lock);
      return driver.execute(plan, lock);
    },
  };
}
