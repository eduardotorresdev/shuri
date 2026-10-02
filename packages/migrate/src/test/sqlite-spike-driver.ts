// F5 spike (plan section 16): proof that the MigrationDriver port serves a relational engine.
// A throwaway SQLite driver (node:sqlite) for createEntity, addField and alterField, the way D1
// needs them: every structural change is a table rebuild run in ONE transaction together with the
// journal row. It stays until F10 turns it into the real `@shuri/store-d1` driver.
import { DatabaseSync } from "node:sqlite";
import { createMemoryJournal } from "../driver/memory-journal.js";
import type {
  DriverPlan,
  DriverStep,
  MigrationDriver,
  PlannedMigration,
} from "../driver/types.js";
import { describeOp } from "../graph/format-conflict.js";
import { isDestructive } from "../ops/conversion.js";
import { applyOp } from "../ops/replay.js";
import type { ReplayState } from "../ops/state.js";
import type { MigrationOp, TargetRef } from "../ops/types.js";
import type { FieldShape, FieldSpec } from "../schema/snapshot.js";

export class SpikeUnsupportedError extends Error {}

const quote = (name: string) => `"${name}"`;

function columnType(spec: FieldShape): string {
  if (spec.type === "number") return spec.kind === "integer" ? "INTEGER" : "REAL";
  return spec.type === "boolean" ? "INTEGER" : "TEXT";
}

function columnSql(name: string, spec: FieldSpec): string {
  const fk =
    spec.type === "relation" && !spec.multiple
      ? ` REFERENCES ${quote(spec.collection)}("id")`
      : "";
  return `${quote(name)} ${columnType(spec)}${fk}`;
}

// A plain decimal (`-?\d+(\.\d+)?`) spelled with GLOB, which has no regex.
function isDecimal(v: string, integer: boolean): string {
  const body = `(CASE WHEN substr(${v},1,1)='-' THEN substr(${v},2) ELSE ${v} END)`;
  const digits = `${body} <> '' AND ${body} NOT GLOB '*[^0-9]*'`;
  if (integer) return digits;
  const dotted = `${body} GLOB '[0-9]*.[0-9]*' AND ${body} NOT GLOB '*[^0-9.]*' AND ${body} NOT GLOB '*.*.*' AND ${body} NOT GLOB '*.' AND ${body} NOT GLOB '.*'`;
  return `(${digits}) OR (${dotted})`;
}

const textual = (shape: FieldShape): boolean =>
  shape.type === "text" || shape.type === "textarea";

/**
 * The SQL that turns the old column into the new one: `convertValue` written as CASE/CAST over the
 * old row, idempotent (it only converts values of the source type). Only a subset of the matrix.
 * @param col - The column name.
 * @param from - The shape before.
 * @param to - The shape after.
 * @returns A SQL expression over the old row.
 * @throws {SpikeUnsupportedError} For a pair of shapes the spike does not implement.
 */
function convertExpr(col: string, from: FieldShape, to: FieldShape): string {
  const c = quote(col);
  if (JSON.stringify(from) === JSON.stringify(to)) return c;
  if (textual(from) && textual(to)) return c;
  if (from.type === "number" && to.type === "number") {
    return to.kind === "float"
      ? c
      : `CASE WHEN typeof(${c}) IN ('integer','real') THEN CAST(${c} AS INTEGER) ELSE ${c} END`;
  }
  if (from.type === "number" && textual(to)) {
    return `CASE WHEN typeof(${c}) IN ('integer','real') THEN CAST(${c} AS TEXT) ELSE ${c} END`;
  }
  if (from.type === "boolean" && textual(to)) {
    return `CASE WHEN typeof(${c})='integer' THEN (CASE ${c} WHEN 1 THEN 'true' ELSE 'false' END) ELSE ${c} END`;
  }
  if (textual(from) && to.type === "number") {
    const cast = to.kind === "integer" ? "INTEGER" : "REAL";
    return `CASE WHEN typeof(${c})='text' THEN (CASE WHEN ${isDecimal(c, to.kind === "integer")} THEN CAST(${c} AS ${cast}) ELSE NULL END) ELSE ${c} END`;
  }
  if (textual(from) && to.type === "boolean") {
    return `CASE WHEN typeof(${c})='text' THEN (CASE ${c} WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE NULL END) ELSE ${c} END`;
  }
  throw new SpikeUnsupportedError(
    `alterField ${from.type} -> ${to.type} is not implemented in the spike`,
  );
}

const indexSql = (table: string, fields: Record<string, FieldSpec>) =>
  Object.entries(fields)
    .filter(([, spec]) => spec.index)
    .map(
      ([name]) =>
        `CREATE INDEX ${quote(`${table}_${name}_idx`)} ON ${quote(table)} (${quote(name)})`,
    );

const fieldsOf = (state: ReplayState, target: TargetRef) =>
  state.snapshot.collections[target.slug].fields;

// Statements for one op, given the state just before it.
function statementsFor(op: MigrationOp, before: ReplayState): string[] {
  if (op.target.kind !== "collection") {
    throw new SpikeUnsupportedError(
      `${op.op} on a global is not implemented in the spike`,
    );
  }
  const table = op.target.slug;
  switch (op.op) {
    case "createEntity":
      return [
        `CREATE TABLE ${quote(table)} ("id" TEXT PRIMARY KEY${Object.entries(op.fields)
          .map(([name, spec]) => `, ${columnSql(name, spec)}`)
          .join("")})`,
        ...indexSql(table, op.fields),
      ];
    case "addField":
    case "alterField": {
      const old = fieldsOf(before, op.target);
      const next: Record<string, FieldSpec> =
        op.op === "addField"
          ? { ...old, [op.name]: op.spec }
          : { ...old, [op.name]: { ...op.to, index: old[op.name].index } as FieldSpec };
      const copied = Object.keys(old);
      const exprs = copied.map((name) =>
        op.op === "alterField" && name === op.name
          ? convertExpr(name, op.from, op.to)
          : quote(name),
      );
      const temp = `_rebuild_${table}`;
      return [
        `CREATE TABLE ${quote(temp)} ("id" TEXT PRIMARY KEY${Object.entries(next)
          .map(([name, spec]) => `, ${columnSql(name, spec)}`)
          .join("")})`,
        `INSERT INTO ${quote(temp)} ("id"${copied.map((n) => `, ${quote(n)}`).join("")}) ` +
          `SELECT "id"${exprs.map((e) => `, ${e}`).join("")} FROM ${quote(table)}`,
        `DROP TABLE ${quote(table)}`,
        `ALTER TABLE ${quote(temp)} RENAME TO ${quote(table)}`,
        ...indexSql(table, next),
      ];
    }
    default:
      throw new SpikeUnsupportedError(`${op.op} is not implemented in the spike`);
  }
}

export class SpikeInjectedFailure extends Error {}

export interface SqliteSpike {
  driver: MigrationDriver;
  db: DatabaseSync;
  /** Fails the next `execute` right after it ran `afterStatement` statements (journal row not yet written). */
  injectFailure(afterStatement: number): void;
}

/**
 * @param options - `maxColumns` is the limit `validateSnapshot` enforces (D1 has 100).
 * @returns The driver and the database it works on.
 */
export function createSqliteSpike(options: { maxColumns?: number } = {}): SqliteSpike {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE _migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, status TEXT NOT NULL,
       started_at TEXT NOT NULL, finished_at TEXT)`,
  );
  const memory = createMemoryJournal();
  const maxColumns = options.maxColumns ?? 100;
  let failAfter: number | undefined;

  const stepsOf = (m: PlannedMigration): DriverStep[] => {
    let state = m.before;
    const steps: DriverStep[] = [];
    for (const planned of m.ops) {
      if (planned.effect === "applied") {
        const tail = planned.dependents.map((d) => d.slug).join(", ");
        steps.push({
          description: describeOp(planned.op) + (tail ? ` [dependents: ${tail}]` : ""),
          destructive: isDestructive(planned.op),
          statements: statementsFor(planned.op, state),
        });
      }
      state = applyOp(state, planned.op).state;
    }
    return steps;
  };

  const driver: MigrationDriver = {
    capabilities: { atomicity: "migration", transactionalJournal: true, render: true },
    validateSnapshot: (snapshot) =>
      Object.entries(snapshot.collections)
        .filter(([, entity]) => Object.keys(entity.fields).length + 1 > maxColumns)
        .map(([slug]) => ({
          path: `collections.${slug}`,
          message: `at most ${maxColumns} columns (including id)`,
        })),
    acquireLock: memory.acquireLock,
    lockInfo: memory.lockInfo,
    forceUnlock: memory.forceUnlock,
    async applied() {
      const rows = db.prepare("SELECT * FROM _migrations ORDER BY rowid").all();
      return rows.map((r) => ({
        id: r.id as string,
        checksum: r.checksum as string,
        status: r.status as "running" | "done",
        startedAt: r.started_at as string,
        ...(r.finished_at ? { finishedAt: r.finished_at as string } : {}),
      }));
    },
    async plan(m): Promise<DriverPlan> {
      return { migration: m, steps: stepsOf(m) };
    },
    render: (plan) =>
      plan.steps
        .map(
          (s) =>
            `-- ${s.description}\n${(s.statements ?? []).map((q) => `${q};`).join("\n")}`,
        )
        .join("\n"),
    async execute(plan, lock) {
      await lock.assertHeld();
      const rebuilds = plan.migration.ops.some((p) => p.dependents.length > 0);
      // SQLite cannot change this pragma inside a transaction; the rebuild drops tables others point at.
      if (rebuilds) db.exec("PRAGMA foreign_keys = OFF");
      db.exec("BEGIN");
      try {
        let ran = 0;
        for (const step of plan.steps) {
          for (const sql of step.statements ?? []) {
            db.exec(sql);
            if (failAfter !== undefined && ++ran >= failAfter) {
              failAfter = undefined;
              throw new SpikeInjectedFailure(`injected failure after statement ${ran}`);
            }
          }
        }
        const violations = db.prepare("PRAGMA foreign_key_check").all();
        if (violations.length > 0)
          throw new Error("foreign key violations after the rebuild");
        const at = new Date().toISOString();
        await lock.assertHeld();
        db.prepare(
          "INSERT INTO _migrations (id, checksum, status, started_at, finished_at) VALUES (?, ?, 'done', ?, ?)",
        ).run(plan.migration.id, plan.migration.checksum, at, at);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        if (rebuilds) db.exec("PRAGMA foreign_keys = ON");
      }
    },
    journal: {
      async markApplied({ id, checksum }) {
        const at = new Date().toISOString();
        db.prepare(
          "INSERT OR REPLACE INTO _migrations (id, checksum, status, started_at, finished_at) VALUES (?, ?, 'done', ?, ?)",
        ).run(id, checksum, at, at);
      },
      async unmark(id) {
        db.prepare("DELETE FROM _migrations WHERE id = ?").run(id);
      },
      async setChecksum(id, checksum) {
        db.prepare("UPDATE _migrations SET checksum = ? WHERE id = ?").run(checksum, id);
      },
    },
  };

  return {
    driver,
    db,
    injectFailure(afterStatement) {
      failAfter = afterStatement;
    },
  };
}
