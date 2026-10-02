import { canonicalJson } from "../schema/canonical-json.js";
import {
  EMPTY_SNAPSHOT,
  snapshotsEqual,
  type SchemaSnapshot,
} from "../schema/snapshot.js";
import type { TargetRef } from "./types.js";

/** Identity of a schema element across renames; see `mintLineage`. */
export type Lineage = string;

export interface ReplayState {
  snapshot: SchemaSnapshot;
  lineage: {
    /** key `<kind>:<slug>` */
    entities: Record<string, Lineage>;
    /** key `<kind>:<slug>.<name>` */
    fields: Record<string, Lineage>;
  };
  /** slot -> lineage last removed from it by a drop. */
  tombstones: Record<string, Lineage>;
}

export const EMPTY_STATE: ReplayState = Object.freeze({
  snapshot: EMPTY_SNAPSHOT,
  lineage: Object.freeze({ entities: Object.freeze({}), fields: Object.freeze({}) }),
  tombstones: Object.freeze({}),
});

/**
 * @param target - An entity.
 * @returns Its slot key, `<kind>:<slug>`.
 */
export function entityKey(target: TargetRef): string {
  return `${target.kind}:${target.slug}`;
}

/**
 * @param target - The entity owning the field.
 * @param name - The field name.
 * @returns The field's slot key, `<kind>:<slug>.<name>`.
 */
export function fieldKey(target: TargetRef, name: string): string {
  return `${target.kind}:${target.slug}.${name}`;
}

/**
 * Lineage for a slot being created: `<slot>@<tombstone or '->`. It depends only on the slot and on
 * what was dropped from it before, never on the migration that creates it, so two branches that add
 * the same field mint the same lineage, while a field recreated after a drop differs from the one a
 * rename carried over.
 * @param state - The state the slot is being created in.
 * @param slot - The slot key.
 * @returns The new lineage.
 */
export function mintLineage(state: ReplayState, slot: string): Lineage {
  return `${slot}@${state.tombstones[slot] ?? "-"}`;
}

/**
 * The state a snapshot has when taken as a starting point: every element carries the lineage it
 * would have if created from nothing.
 * @param snapshot - The snapshot (typically the replay of a common ancestor).
 * @returns A state for it.
 */
export function stateOf(snapshot: SchemaSnapshot): ReplayState {
  const state: ReplayState = {
    snapshot: structuredClone(snapshot),
    lineage: { entities: {}, fields: {} },
    tombstones: {},
  };
  for (const kind of ["collection", "global"] as const) {
    const entities = kind === "collection" ? snapshot.collections : snapshot.globals;
    for (const [slug, entity] of Object.entries(entities)) {
      const target = { kind, slug };
      state.lineage.entities[entityKey(target)] = `${entityKey(target)}@-`;
      for (const name of Object.keys(entity.fields)) {
        state.lineage.fields[fieldKey(target, name)] = `${fieldKey(target, name)}@-`;
      }
    }
  }
  return state;
}

/**
 * Two states are equivalent when they describe the same schema AND every element has the same
 * lineage. Tombstones are history, not state, so they are not compared.
 * @param a - Left state.
 * @param b - Right state.
 * @returns Whether the states are interchangeable for the purpose of ordering migrations.
 */
export function statesEquivalent(a: ReplayState, b: ReplayState): boolean {
  return (
    snapshotsEqual(a.snapshot, b.snapshot) &&
    canonicalJson(a.lineage) === canonicalJson(b.lineage)
  );
}
