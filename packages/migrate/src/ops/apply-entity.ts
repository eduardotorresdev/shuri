import { ReplayError } from "../errors.js";
import { structurallyEqual } from "../schema/snapshot.js";
import {
  createField,
  entitiesOf,
  entityOf,
  moveLineage,
  removeField,
  type OpEffect,
} from "./apply-shared.js";
import { entityKey, fieldKey, mintLineage, type ReplayState } from "./state.js";
import type { MigrationOp } from "./types.js";

export function createEntity(
  state: ReplayState,
  op: Extract<MigrationOp, { op: "createEntity" }>,
): OpEffect {
  const existing = entityOf(state, op.target);
  if (existing) {
    if (structurallyEqual(existing.fields, op.fields)) return "noop";
    throw new ReplayError(
      op,
      "entity-exists-different",
      `${entityKey(op.target)} already exists with different fields`,
    );
  }
  const key = entityKey(op.target);
  entitiesOf(state, op.target.kind)[op.target.slug] = { fields: {} };
  state.lineage.entities[key] = mintLineage(state, key);
  for (const [name, spec] of Object.entries(op.fields)) {
    createField(state, op.target, name, structuredClone(spec));
  }
  return "applied";
}

export function dropEntity(
  state: ReplayState,
  op: Extract<MigrationOp, { op: "dropEntity" }>,
): OpEffect {
  const entity = entityOf(state, op.target);
  if (!entity) return "noop";
  for (const name of Object.keys(entity.fields)) removeField(state, op.target, name);
  const key = entityKey(op.target);
  const lineage = state.lineage.entities[key];
  if (lineage !== undefined) state.tombstones[key] = lineage;
  delete state.lineage.entities[key];
  delete entitiesOf(state, op.target.kind)[op.target.slug];
  return "applied";
}

export function renameEntity(
  state: ReplayState,
  op: Extract<MigrationOp, { op: "renameEntity" }>,
): OpEffect {
  const { target, to } = op;
  const toTarget = { kind: target.kind, slug: to };
  const fromEntity = entityOf(state, target);
  const toEntity = entityOf(state, toTarget);
  if (fromEntity && toEntity) {
    throw new ReplayError(
      op,
      "rename-both-exist",
      `both ${entityKey(target)} and ${entityKey(toTarget)} exist`,
    );
  }
  if (!fromEntity) {
    if (toEntity) return "noop";
    throw new ReplayError(
      op,
      "rename-neither-exists",
      `neither ${entityKey(target)} nor ${entityKey(toTarget)} exists`,
    );
  }
  const entities = entitiesOf(state, target.kind);
  entities[to] = fromEntity;
  delete entities[target.slug];
  moveLineage(state.lineage.entities, entityKey(target), entityKey(toTarget));
  for (const name of Object.keys(fromEntity.fields)) {
    moveLineage(state.lineage.fields, fieldKey(target, name), fieldKey(toTarget, name));
  }
  if (target.kind === "collection") {
    for (const entity of [
      ...Object.values(state.snapshot.collections),
      ...Object.values(state.snapshot.globals),
    ]) {
      for (const spec of Object.values(entity.fields)) {
        if (spec.type === "relation" && spec.collection === target.slug) {
          spec.collection = to;
        }
      }
    }
  }
  return "applied";
}
