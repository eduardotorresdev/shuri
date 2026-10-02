import {
  convertValue,
  createMemoryJournal,
  describeOp,
  isDestructive,
  type DriverPlan,
  type DriverStep,
  type MigrationDriver,
  type MigrationOp,
  type PlannedOp,
  RenameCollisionError,
  type TargetRef,
} from "@shuri/migrate";
import { cloneTable, type MemoryState } from "./tables.js";

export interface MemoryMigrationsOptions {
  /** Clock stamping the journal and the lock (default: the real one). */
  now?: () => Date;
  /**
   * Called before the first op (`done` = 0) and after each one, with how many ops have run. A test
   * seam: throwing from it simulates a crash at that point, and since the driver is atomic the data
   * and the journal must come out untouched.
   */
  onStep?: (done: number) => void;
}

/**
 * A working copy of the state that clones a table or a global only when an op first writes to it:
 * everything else is shared with the live state, so a migration costs what it touches.
 */
class Draft {
  readonly state: MemoryState;
  private readonly ownedTables = new Set<string>();
  private readonly ownedGlobals = new Set<string>();

  constructor(live: MemoryState) {
    this.state = { tables: new Map(live.tables), globals: new Map(live.globals) };
  }

  /**
   * @param target - An entity.
   * @returns The records of the entity, safe to mutate (cloned on first use).
   */
  records(target: TargetRef): Record<string, unknown>[] {
    if (target.kind === "collection") {
      const table = this.state.tables.get(target.slug);
      if (!table) return [];
      if (!this.ownedTables.has(target.slug)) {
        const own = cloneTable(table);
        this.state.tables.set(target.slug, own);
        this.ownedTables.add(target.slug);
        return [...own.rows.values()];
      }
      return [...table.rows.values()];
    }
    const doc = this.state.globals.get(target.slug);
    if (!doc) return [];
    if (!this.ownedGlobals.has(target.slug)) {
      const own = structuredClone(doc);
      this.state.globals.set(target.slug, own);
      this.ownedGlobals.add(target.slug);
      return [own];
    }
    return [doc];
  }

  /**
   * @param target - An entity.
   * @returns Whether the draft already holds its own copy of the entity.
   */
  owns(target: TargetRef): boolean {
    return (target.kind === "collection" ? this.ownedTables : this.ownedGlobals).has(
      target.slug,
    );
  }

  /**
   * Registers a table or global the draft created or moved as already its own.
   * @param target - An entity.
   */
  adopt(target: TargetRef): void {
    (target.kind === "collection" ? this.ownedTables : this.ownedGlobals).add(
      target.slug,
    );
  }

  /**
   * Forgets ownership of a removed or moved name.
   * @param target - An entity.
   */
  release(target: TargetRef): void {
    (target.kind === "collection" ? this.ownedTables : this.ownedGlobals).delete(
      target.slug,
    );
  }
}

/**
 * @param state - The state to read.
 * @param target - An entity.
 * @returns Every record the entity holds: the rows of a collection, the one document of a global.
 */
function recordsOf(state: MemoryState, target: TargetRef): Record<string, unknown>[] {
  if (target.kind === "collection") {
    return [...(state.tables.get(target.slug)?.rows.values() ?? [])];
  }
  const doc = state.globals.get(target.slug);
  return doc ? [doc] : [];
}

function setValue(record: Record<string, unknown>, name: string, value: unknown): void {
  if (value === undefined) delete record[name];
  else record[name] = value;
}

function renameEntity(draft: Draft, target: TargetRef, to: string): void {
  const from = target.slug;
  const { state } = draft;
  if (target.kind === "collection") {
    const table = state.tables.get(from);
    if (!table) return;
    if ((state.tables.get(to)?.rows.size ?? 0) > 0) {
      throw new RenameCollisionError(target, to);
    }
    const owned = draft.owns(target);
    const destination: TargetRef = { kind: "collection", slug: to };
    state.tables.delete(from);
    state.tables.set(to, table);
    draft.release(target);
    draft.release(destination);
    // The table object is unchanged (cloned or not), only its name moved.
    if (owned) draft.adopt(destination);
    return;
  }
  const doc = state.globals.get(from);
  if (doc === undefined) return;
  if (state.globals.has(to)) throw new RenameCollisionError(target, to);
  const owned = draft.owns(target);
  const destination: TargetRef = { kind: "global", slug: to };
  state.globals.delete(from);
  state.globals.set(to, doc);
  draft.release(target);
  draft.release(destination);
  if (owned) draft.adopt(destination);
}

/**
 * Applies one op to the draft. Idempotent over data an earlier run left half-changed: a rename
 * whose source is gone, a drop of what is gone and a re-create all do nothing. Indexes are not
 * touched here: a cloned table is rebuilt from the schema when next read.
 * @param draft - The working copy.
 * @param op - The op.
 * @throws {RenameCollisionError} If an entity rename would overwrite data.
 */
function applyOpToDraft(draft: Draft, op: MigrationOp): void {
  const { state } = draft;
  switch (op.op) {
    case "createEntity":
      if (op.target.kind === "collection" && !state.tables.has(op.target.slug)) {
        state.tables.set(op.target.slug, {
          rows: new Map(),
          indexes: new Map(),
          schema: undefined,
        });
        draft.adopt(op.target);
      }
      return;
    case "dropEntity":
      if (op.target.kind === "collection") state.tables.delete(op.target.slug);
      else state.globals.delete(op.target.slug);
      draft.release(op.target);
      return;
    case "renameEntity":
      renameEntity(draft, op.target, op.to);
      return;
    case "dropField":
      for (const record of draft.records(op.target)) delete record[op.name];
      return;
    case "renameField":
      for (const record of draft.records(op.target)) {
        if (op.from in record && !(op.to in record)) {
          record[op.to] = record[op.from];
          delete record[op.from];
        }
      }
      return;
    case "alterField":
      for (const record of draft.records(op.target)) {
        if (op.name in record) {
          setValue(record, op.name, convertValue(record[op.name], op.from, op.to));
        }
      }
      return;
    case "addField":
    case "setIndex":
      return;
  }
}

const TOUCHES_DATA = new Set<MigrationOp["op"]>([
  "dropEntity",
  "renameEntity",
  "dropField",
  "renameField",
  "alterField",
]);

/**
 * The `MigrationDriver` of the memory store. Atomic per migration by copy-on-write: the ops run
 * on a copy-on-write draft (only the tables and globals an op writes to are cloned), the journal
 * records the migration as done, and only then is the draft swapped in, in the same synchronous
 * step. A failure anywhere before that leaves the data and the journal as they were.
 * @param state - The state the adapter reads and writes.
 * @param options - Clock and the test seam.
 * @returns The driver.
 */
export function createMemoryMigrations(
  state: MemoryState,
  options: MemoryMigrationsOptions = {},
): MigrationDriver {
  const journal = createMemoryJournal(options.now);

  const step = (planned: PlannedOp): DriverStep => {
    const { op } = planned;
    const rows = TOUCHES_DATA.has(op.op) ? recordsOf(state, op.target).length : undefined;
    return {
      description: describeOp(op),
      destructive: isDestructive(op),
      ...(rows === undefined ? {} : { estimatedRows: rows }),
    };
  };

  return {
    capabilities: { atomicity: "migration", transactionalJournal: true, render: false },
    acquireLock: journal.acquireLock,
    lockInfo: journal.lockInfo,
    forceUnlock: journal.forceUnlock,
    applied: journal.applied,
    journal: journal.journal,
    async plan(migration): Promise<DriverPlan> {
      return {
        migration,
        steps: migration.ops.filter((p) => p.effect === "applied").map(step),
      };
    },
    async execute(plan, lock) {
      const { id, checksum } = plan.migration;
      const draft = new Draft(state);
      options.onStep?.(0);
      let done = 0;
      for (const { op, effect } of plan.migration.ops) {
        if (effect !== "applied") continue;
        await lock.assertHeld();
        applyOpToDraft(draft, op);
        options.onStep?.(++done);
      }
      await lock.assertHeld();
      // Journal first: if it fails the live data is untouched. The swap that follows is
      // synchronous, so no reader sees the journal ahead of the data.
      await journal.journal.markApplied({ id, checksum });
      state.tables = draft.state.tables;
      state.globals = draft.state.globals;
    },
  };
}
