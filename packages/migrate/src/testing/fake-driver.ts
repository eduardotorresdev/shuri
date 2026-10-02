import { describeOp } from "../graph/format-conflict.js";
import { createMemoryJournal } from "../driver/memory-journal.js";
import type { DriverPlan, MigrationDriver } from "../driver/types.js";
import { isDestructive } from "../ops/conversion.js";
import { applyOpToData, emptyFakeData, type FakeData } from "./fake-data.js";
import type { ContractAdapter, ContractRow } from "./types.js";

/** Thrown by the fake when a failure was armed with `injectFailure`. */
export class FakeInjectedFailure extends Error {
  readonly afterStep: number;

  constructor(afterStep: number) {
    super(`injected failure after step ${afterStep}`);
    this.name = "FakeInjectedFailure";
    this.afterStep = afterStep;
  }
}

export interface FakeStoreOptions {
  /**
   * `migration` (default): runs on a copy and swaps it in together with the journal entry, so a
   * failure leaves nothing. `none`: changes live data op by op with a `running` journal entry, so
   * a failure leaves what was done (the shape of a non-atomic driver).
   */
  atomicity?: "migration" | "none";
  now?: () => Date;
}

export interface FakeStore {
  adapter: ContractAdapter;
  /** Arms a one-shot failure after `afterStep` steps; see `ContractWorld.injectFailure`. */
  injectFailure(afterStep: number): void;
  /** A snapshot of the stored data, for assertions. */
  dump(): FakeData;
}

/**
 * An in-memory store with a `MigrationDriver`, for testing the runner and the contract suite
 * itself. It is the reference for how a driver honours the contract.
 * @param options - Atomicity and clock.
 * @returns The store, a failure injector and a data dump.
 */
export function createFakeStore(options: FakeStoreOptions = {}): FakeStore {
  const atomic = (options.atomicity ?? "migration") === "migration";
  let data = emptyFakeData();
  let failAfter: number | undefined;
  const journal = createMemoryJournal(options.now);

  const failIfDue = (done: number) => {
    if (failAfter !== undefined && done >= failAfter) {
      failAfter = undefined;
      throw new FakeInjectedFailure(done);
    }
  };

  const migrations: MigrationDriver = {
    capabilities: {
      atomicity: atomic ? "migration" : "none",
      transactionalJournal: atomic,
      render: false,
    },
    acquireLock: journal.acquireLock,
    lockInfo: journal.lockInfo,
    forceUnlock: journal.forceUnlock,
    applied: journal.applied,
    journal: journal.journal,
    async plan(m): Promise<DriverPlan> {
      const steps = m.ops
        .filter((p) => p.effect === "applied")
        .map((p) => ({
          description: describeOp(p.op),
          destructive: isDestructive(p.op),
        }));
      return { migration: m, steps };
    },
    async execute(plan, lock) {
      const { id, checksum } = plan.migration;
      const ops = plan.migration.ops.filter((p) => p.effect === "applied");
      const target = atomic ? structuredClone(data) : data;
      if (!atomic) journal.begin({ id, checksum });
      failIfDue(0);
      let done = 0;
      for (const { op } of ops) {
        await lock.assertHeld();
        applyOpToData(target, op);
        failIfDue(++done);
      }
      await lock.assertHeld();
      if (atomic) {
        data = target;
        await journal.journal.markApplied({ id, checksum });
      } else {
        journal.finish(id);
      }
    },
  };

  const rowsOf = (slug: string) => (data.collections[slug] ??= []);
  const adapter: ContractAdapter = {
    migrations,
    async insert(c, values) {
      const row: ContractRow = { ...structuredClone(values), id: String(data.nextId++) };
      rowsOf(c.slug).push(row);
      return structuredClone(row);
    },
    async findMany(c) {
      return structuredClone(data.collections[c.slug] ?? []);
    },
    async findGlobal(g) {
      return structuredClone(data.globals[g.slug]);
    },
    async updateGlobal(g, values) {
      data.globals[g.slug] = { ...data.globals[g.slug], ...structuredClone(values) };
      return structuredClone(data.globals[g.slug]);
    },
  };

  return {
    adapter,
    injectFailure(afterStep) {
      failAfter = afterStep;
    },
    dump: () => structuredClone(data),
  };
}
