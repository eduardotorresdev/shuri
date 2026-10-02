import { compareCodePoints } from "../schema/canonical-json.js";
import type { EntitySnapshot, SchemaSnapshot } from "../schema/snapshot.js";
import { diffFields } from "./diff-fields.js";
import type { DiffResult, DiffWarning } from "./diff-types.js";
import {
  assertRenameHints,
  orderRenames,
  validateRenames,
  type RenameHints,
  type RenameItem,
} from "./diff-hints.js";
import { applyOp } from "./replay.js";
import { entityKey, stateOf } from "./state.js";
import type { MigrationOp, TargetKind } from "./types.js";

export type { RenameHints } from "./diff-hints.js";
export type { DiffResult, DiffWarning } from "./diff-types.js";

const KINDS: readonly TargetKind[] = ["collection", "global"];

const entitiesIn = (snapshot: SchemaSnapshot, kind: TargetKind) =>
  kind === "collection" ? snapshot.collections : snapshot.globals;

const slugsOf = (entities: Record<string, EntitySnapshot>) =>
  Object.keys(entities).toSorted(compareCodePoints);

const has = (entities: Record<string, EntitySnapshot>, slug: string) =>
  Object.hasOwn(entities, slug);

function sidesOf(
  prevOf: (scope: string) => Record<string, unknown> | undefined,
  nextOf: (scope: string) => Record<string, unknown> | undefined,
) {
  return {
    inPrev: (scope: string, name: string) => {
      const side = prevOf(scope);
      return side !== undefined && Object.hasOwn(side, name);
    },
    inNext: (scope: string, name: string) => {
      const side = nextOf(scope);
      return side !== undefined && Object.hasOwn(side, name);
    },
  };
}

/**
 * Computes the ops that take `prev` to `next`. Renames only happen through `hints` (D7); an unhinted
 * rename is a drop plus an add, flagged by a `possible-rename` warning.
 *
 * Order: renameEntity, createEntity, then per surviving entity renameField, addField, alterField,
 * setIndex, dropField, and finally dropEntity. Inside each group: kind (collection first), slug, name.
 * Invariant: replaying the ops over `prev` yields `next`.
 * @param prev - The snapshot the database is at.
 * @param next - The snapshot the schema now describes.
 * @param hints - Explicit renames.
 * @returns The ops and the warnings.
 * @throws {DiffHintError} When a hint is duplicated, cyclic, or does not line up with the snapshots.
 */
export function diff(
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  hints: RenameHints = {},
): DiffResult {
  assertRenameHints(hints);
  const ops: MigrationOp[] = [];
  const warnings: DiffWarning[] = [];

  // 1-2. Entity renames: validated, ordered, applied to `prev` so relations follow the new names.
  const entityItems: RenameItem<unknown>[] = (hints.entities ?? []).map((hint) => ({
    hint,
    scope: hint.kind,
    from: hint.from,
    to: hint.to,
  }));
  const entitySides = sidesOf(
    (kind) => entitiesIn(prev, kind as TargetKind),
    (kind) => entitiesIn(next, kind as TargetKind),
  );
  validateRenames(entityItems, entitySides);
  let state = stateOf(prev);
  for (const item of orderRenames(entityItems)) {
    const op: MigrationOp = {
      op: "renameEntity",
      target: { kind: item.scope as TargetKind, slug: item.from },
      to: item.to,
    };
    ops.push(op);
    state = applyOp(state, op).state;
  }
  const renamed = state.snapshot;

  // 3. createEntity (complete fields: integrity is only checked at the end of the migration).
  for (const kind of KINDS) {
    for (const slug of slugsOf(entitiesIn(next, kind))) {
      if (has(entitiesIn(renamed, kind), slug)) continue;
      const entity = entitiesIn(next, kind)[slug] as EntitySnapshot;
      ops.push({
        op: "createEntity",
        target: { kind, slug },
        fields: structuredClone(entity.fields),
      });
    }
  }

  // 4. Fields of entities present on both sides.
  const fieldItems: RenameItem<unknown>[] = (hints.fields ?? []).map((hint) => ({
    hint,
    scope: entityKey(hint.target),
    from: hint.from,
    to: hint.to,
  }));
  const fieldsOfScope = (snapshot: SchemaSnapshot) => (scope: string) => {
    const [kind, slug] = [
      scope.slice(0, scope.indexOf(":")),
      scope.slice(scope.indexOf(":") + 1),
    ];
    const entities = entitiesIn(snapshot, kind as TargetKind);
    return has(entities, slug) ? (entities[slug] as EntitySnapshot).fields : undefined;
  };
  validateRenames(fieldItems, sidesOf(fieldsOfScope(renamed), fieldsOfScope(next)));
  for (const kind of KINDS) {
    for (const slug of slugsOf(entitiesIn(next, kind))) {
      const before = entitiesIn(renamed, kind)[slug];
      if (!before) continue;
      const target = { kind, slug };
      const result = diffFields(
        target,
        before,
        entitiesIn(next, kind)[slug] as EntitySnapshot,
        fieldItems.filter((item) => item.scope === entityKey(target)),
      );
      ops.push(...result.ops);
      warnings.push(...result.warnings);
    }
  }

  // 5. dropEntity.
  for (const kind of KINDS) {
    for (const slug of slugsOf(entitiesIn(renamed, kind))) {
      if (!has(entitiesIn(next, kind), slug)) {
        ops.push({ op: "dropEntity", target: { kind, slug } });
      }
    }
  }
  return { ops, warnings };
}
