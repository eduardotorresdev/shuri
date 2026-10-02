import { compareCodePoints } from "../schema/canonical-json.js";
import {
  shapeOf,
  structurallyEqual,
  type EntitySnapshot,
  type FieldSpec,
} from "../schema/snapshot.js";
import type { DiffWarning } from "./diff-types.js";
import { orderRenames, type RenameItem } from "./diff-hints.js";
import type { MigrationOp, TargetRef } from "./types.js";

const byName = (a: string, b: string) => compareCodePoints(a, b);

/**
 * Field ops for one entity that exists on both sides, in the fixed order
 * renameField, addField, alterField, setIndex, dropField (names in code point order).
 * @param target - The entity (new slug).
 * @param prev - Its fields before, with entity renames already applied.
 * @param next - Its fields after.
 * @param renames - Validated field renames for this entity.
 * @returns The ops and the `possible-rename` warnings for unhinted drop+add pairs.
 */
export function diffFields(
  target: TargetRef,
  prev: EntitySnapshot,
  next: EntitySnapshot,
  renames: readonly RenameItem<unknown>[],
): { ops: MigrationOp[]; warnings: DiffWarning[] } {
  const ops: MigrationOp[] = [];
  const working: Record<string, FieldSpec> = { ...prev.fields };
  for (const { from, to } of orderRenames(renames)) {
    working[to] = working[from] as FieldSpec;
    delete working[from];
    ops.push({ op: "renameField", target, from, to });
  }

  const added = Object.keys(next.fields)
    .filter((name) => !Object.hasOwn(working, name))
    .toSorted(byName);
  const dropped = Object.keys(working)
    .filter((name) => !Object.hasOwn(next.fields, name))
    .toSorted(byName);
  const common = Object.keys(next.fields)
    .filter((name) => Object.hasOwn(working, name))
    .toSorted(byName);

  for (const name of added) {
    ops.push({ op: "addField", target, name, spec: next.fields[name] as FieldSpec });
  }
  for (const name of common) {
    const from = working[name] as FieldSpec;
    const to = next.fields[name] as FieldSpec;
    if (!structurallyEqual(shapeOf(from), shapeOf(to))) {
      ops.push({
        op: "alterField",
        target,
        name,
        from: shapeOf(from),
        to: shapeOf(to),
      });
    }
  }
  for (const name of common) {
    const from = working[name] as FieldSpec;
    const to = next.fields[name] as FieldSpec;
    if (from.index !== to.index) {
      ops.push({ op: "setIndex", target, name, index: to.index });
    }
  }
  for (const name of dropped) ops.push({ op: "dropField", target, name });

  const warnings: DiffWarning[] = [];
  for (const drop of dropped) {
    for (const add of added) {
      const same = structurallyEqual(
        shapeOf(working[drop] as FieldSpec),
        shapeOf(next.fields[add] as FieldSpec),
      );
      if (same)
        warnings.push({ kind: "possible-rename", target, dropped: drop, added: add });
    }
  }
  return { ops, warnings };
}
