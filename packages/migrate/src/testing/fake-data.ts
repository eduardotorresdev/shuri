import { convertValue } from "../ops/convert-value.js";
import type { MigrationOp } from "../ops/types.js";
import type { ContractRow } from "./types.js";

/** What the fake store keeps: rows per collection and one document per global. */
export interface FakeData {
  collections: Record<string, ContractRow[]>;
  globals: Record<string, Record<string, unknown>>;
  nextId: number;
}

export const emptyFakeData = (): FakeData => ({
  collections: {},
  globals: {},
  nextId: 1,
});

function setValue(row: Record<string, unknown>, name: string, value: unknown): void {
  if (value === undefined) delete row[name];
  else row[name] = value;
}

// Every row of the entity (the document, for a global).
function recordsOf(
  data: FakeData,
  target: { kind: "collection" | "global"; slug: string },
): Record<string, unknown>[] {
  if (target.kind === "collection") return data.collections[target.slug] ?? [];
  const doc = data.globals[target.slug];
  return doc ? [doc] : [];
}

/**
 * Applies one op to the data in place, the way a driver does. Idempotent over partially applied
 * data: a rename whose source is gone, a drop of what is gone and a re-create all do nothing.
 * @param data - The fake data to change.
 * @param op - The op.
 */
export function applyOpToData(data: FakeData, op: MigrationOp): void {
  switch (op.op) {
    case "createEntity":
      if (op.target.kind === "collection") data.collections[op.target.slug] ??= [];
      return;
    case "dropEntity":
      if (op.target.kind === "collection") delete data.collections[op.target.slug];
      else delete data.globals[op.target.slug];
      return;
    case "renameEntity": {
      const store = op.target.kind === "collection" ? data.collections : data.globals;
      const from = op.target.slug;
      if (!(from in store)) return;
      const target = store[op.to];
      const occupied = Array.isArray(target) ? target.length > 0 : target !== undefined;
      if (occupied)
        throw new Error(`cannot rename ${from} to ${op.to}: ${op.to} has data`);
      (store as Record<string, unknown>)[op.to] = store[from];
      delete store[from];
      return;
    }
    case "dropField":
      for (const record of recordsOf(data, op.target)) delete record[op.name];
      return;
    case "renameField":
      for (const record of recordsOf(data, op.target)) {
        if (op.from in record && !(op.to in record)) {
          record[op.to] = record[op.from];
          delete record[op.from];
        }
      }
      return;
    case "alterField":
      for (const record of recordsOf(data, op.target)) {
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
