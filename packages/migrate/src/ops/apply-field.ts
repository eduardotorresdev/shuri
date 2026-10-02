import { ReplayError } from "../errors.js";
import {
  shapeOf,
  structurallyEqual,
  withIndex,
  type FieldSpec,
} from "../schema/snapshot.js";
import {
  createField,
  entityOf,
  hasField,
  moveLineage,
  removeField,
  requireEntity,
  requireField,
  type OpEffect,
} from "./apply-shared.js";
import { fieldKey, type ReplayState } from "./state.js";
import type { MigrationOp } from "./types.js";

export function addField(
  state: ReplayState,
  op: Extract<MigrationOp, { op: "addField" }>,
): OpEffect {
  const entity = requireEntity(state, op, op.target);
  if (hasField(entity, op.name)) {
    if (structurallyEqual(entity.fields[op.name], op.spec)) return "noop";
    throw new ReplayError(
      op,
      "field-exists-different",
      `${fieldKey(op.target, op.name)} already exists with a different spec`,
    );
  }
  createField(state, op.target, op.name, structuredClone(op.spec));
  return "applied";
}

export function dropField(
  state: ReplayState,
  op: Extract<MigrationOp, { op: "dropField" }>,
): OpEffect {
  const entity = entityOf(state, op.target);
  if (!entity || !hasField(entity, op.name)) return "noop";
  removeField(state, op.target, op.name);
  return "applied";
}

export function renameField(
  state: ReplayState,
  op: Extract<MigrationOp, { op: "renameField" }>,
): OpEffect {
  const entity = requireEntity(state, op, op.target);
  const hasFrom = hasField(entity, op.from);
  const hasTo = hasField(entity, op.to);
  const fromKey = fieldKey(op.target, op.from);
  const toKey = fieldKey(op.target, op.to);
  if (hasFrom && hasTo) {
    throw new ReplayError(op, "rename-both-exist", `both ${fromKey} and ${toKey} exist`);
  }
  if (!hasFrom) {
    if (hasTo) return "noop";
    throw new ReplayError(
      op,
      "rename-neither-exists",
      `neither ${fromKey} nor ${toKey} exists`,
    );
  }
  entity.fields[op.to] = entity.fields[op.from] as FieldSpec;
  delete entity.fields[op.from];
  moveLineage(state.lineage.fields, fromKey, toKey);
  return "applied";
}

export function alterField(
  state: ReplayState,
  op: Extract<MigrationOp, { op: "alterField" }>,
): OpEffect {
  const entity = requireEntity(state, op, op.target);
  const spec = requireField(entity, op, op.target, op.name);
  const shape = shapeOf(spec);
  if (structurallyEqual(shape, op.to)) return "noop";
  if (!structurallyEqual(shape, op.from)) {
    throw new ReplayError(
      op,
      "alter-shape-mismatch",
      `${fieldKey(op.target, op.name)} is neither the expected source nor the target shape`,
    );
  }
  entity.fields[op.name] = withIndex(structuredClone(op.to), spec.index);
  return "applied";
}

export function setIndex(
  state: ReplayState,
  op: Extract<MigrationOp, { op: "setIndex" }>,
): OpEffect {
  const entity = requireEntity(state, op, op.target);
  const spec = requireField(entity, op, op.target, op.name);
  if (spec.index === op.index) return "noop";
  spec.index = op.index;
  return "applied";
}
