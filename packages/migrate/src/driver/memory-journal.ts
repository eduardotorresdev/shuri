import { LockLostError } from "../errors/runner.js";
import type { MigrationId } from "../migration/types.js";
import type {
  AppliedMigration,
  LockInfo,
  MigrationDriver,
  MigrationLock,
} from "./types.js";

/** Lock and journal kept in memory: what the memory driver and the test fake share. */
export interface MemoryJournal {
  acquireLock: MigrationDriver["acquireLock"];
  lockInfo: MigrationDriver["lockInfo"];
  forceUnlock: MigrationDriver["forceUnlock"];
  applied: MigrationDriver["applied"];
  journal: MigrationDriver["journal"];
  /** Records `id` as `running` (non-atomic drivers, before the first op). Re-beginning keeps the entry. */
  begin(entry: Pick<AppliedMigration, "id" | "checksum">): void;
  /** Marks `id` as `done`. */
  finish(id: MigrationId): void;
}

interface HeldLock {
  holder: string;
  expiresAt: Date;
}

const info = (lock: HeldLock): LockInfo => ({
  holder: lock.holder,
  expiresAt: lock.expiresAt.toISOString(),
});

/**
 * @param clock - The clock stamping journal entries (default: the real one).
 * @returns A journal and a TTL lock, both in memory.
 */
export function createMemoryJournal(clock: () => Date = () => new Date()): MemoryJournal {
  const entries: AppliedMigration[] = [];
  let held: HeldLock | undefined;

  const find = (id: MigrationId) => entries.find((entry) => entry.id === id);
  const required = (id: MigrationId): AppliedMigration => {
    const entry = find(id);
    if (!entry) throw new Error(`migration ${id} is not in the journal`);
    return entry;
  };
  const finish = (id: MigrationId) => {
    const entry = required(id);
    entry.status = "done";
    entry.finishedAt = clock().toISOString();
  };
  const lockFor = (holder: string, ttlMs: number, now: () => Date): MigrationLock => {
    const mine = (): HeldLock => {
      if (held?.holder !== holder) throw new LockLostError(holder);
      return held;
    };
    return {
      holder,
      async heartbeat() {
        mine().expiresAt = new Date(now().getTime() + ttlMs);
      },
      async assertHeld() {
        mine();
      },
      async release() {
        if (held?.holder === holder) held = undefined;
      },
    };
  };

  return {
    async acquireLock(holder, ttlMs, now = clock) {
      if (held && held.expiresAt.getTime() >= now().getTime()) return undefined;
      held = { holder, expiresAt: new Date(now().getTime() + ttlMs) };
      return lockFor(holder, ttlMs, now);
    },
    async lockInfo() {
      return held ? info(held) : undefined;
    },
    async forceUnlock() {
      const previous = held;
      held = undefined;
      return previous ? info(previous) : undefined;
    },
    async applied() {
      return entries.map((entry) => ({ ...entry }));
    },
    journal: {
      async markApplied({ id, checksum }) {
        const existing = find(id);
        if (existing) {
          existing.checksum = checksum;
          finish(id);
          return;
        }
        const at = clock().toISOString();
        entries.push({ id, checksum, status: "done", startedAt: at, finishedAt: at });
      },
      async unmark(id) {
        const index = entries.findIndex((entry) => entry.id === id);
        if (index >= 0) entries.splice(index, 1);
      },
      async setChecksum(id, checksum) {
        required(id).checksum = checksum;
      },
    },
    begin({ id, checksum }) {
      if (find(id)) return;
      entries.push({
        id,
        checksum,
        status: "running",
        startedAt: clock().toISOString(),
      });
    },
    finish,
  };
}
