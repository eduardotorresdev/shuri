import { ReplayError } from "../errors.js";
import type { EntitySnapshot, FieldSpec } from "../schema/snapshot.js";
import { entityKey, fieldKey, mintLineage, type ReplayState } from "./state.js";
import type { MigrationOp, TargetRef } from "./types.js";

export type OpEffect = "applied" | "noop";

export function entitiesOf(state: ReplayState, kind: TargetRef["kind"]) {
  return kind === "collection" ? state.snapshot.collections : state.snapshot.globals;
}

export function entityOf(
  state: ReplayState,
  target: TargetRef,
): EntitySnapshot | undefined {
  const entities = entitiesOf(state, target.kind);
  return Object.hasOwn(entities, target.slug) ? entities[target.slug] : undefined;
}

export function requireEntity(state: ReplayState, op: MigrationOp, target: TargetRef) {
  const entity = entityOf(state, target);
  if (!entity) {
    throw new ReplayError(op, "entity-missing", `${entityKey(target)} does not exist`);
  }
  return entity;
}

export function hasField(entity: EntitySnapshot, name: string): boolean {
  return Object.hasOwn(entity.fields, name);
}

export function requireField(
  entity: EntitySnapshot,
  op: MigrationOp,
  target: TargetRef,
  name: string,
) {
  if (!hasField(entity, name)) {
    throw new ReplayError(
      op,
      "field-missing",
      `${fieldKey(target, name)} does not exist`,
    );
  }
  return entity.fields[name] as FieldSpec;
}

export function createField(
  state: ReplayState,
  target: TargetRef,
  name: string,
  spec: FieldSpec,
) {
  const entity = entityOf(state, target) as EntitySnapshot;
  const key = fieldKey(target, name);
  entity.fields[name] = spec;
  state.lineage.fields[key] = mintLineage(state, key);
}

export function removeField(state: ReplayState, target: TargetRef, name: string) {
  const entity = entityOf(state, target) as EntitySnapshot;
  const key = fieldKey(target, name);
  delete entity.fields[name];
  const lineage = state.lineage.fields[key];
  if (lineage !== undefined) state.tombstones[key] = lineage;
  delete state.lineage.fields[key];
}

// Moves a lineage entry to another slot, leaving no tombstone behind.
export function moveLineage(
  table: Record<string, string>,
  from: string,
  to: string,
): void {
  const lineage = table[from];
  delete table[from];
  if (lineage !== undefined) table[to] = lineage;
}
