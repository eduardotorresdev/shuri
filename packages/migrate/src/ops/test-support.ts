import { expect } from "vitest";
import { shapeOf, type FieldSpec, type SchemaSnapshot } from "../schema/snapshot.js";
import {
  DiffHintError,
  ReplayError,
  type DiffHintReason,
  type ReplayErrorReason,
} from "../errors.js";
import { diff, type RenameHints } from "./diff.js";
import { applyOp, replay } from "./replay.js";
import { stateOf, type ReplayState } from "./state.js";
import type { MigrationOp, TargetRef } from "./types.js";

export const col = (slug: string): TargetRef => ({ kind: "collection", slug });
export const glob = (slug: string): TargetRef => ({ kind: "global", slug });

export const text: FieldSpec = { type: "text", index: false };
export const indexedText: FieldSpec = { type: "text", index: true };
export const textarea: FieldSpec = { type: "textarea", index: false };
export const int: FieldSpec = { type: "number", kind: "integer", index: false };
export const rel = (collection: string, multiple = false): FieldSpec => ({
  type: "relation",
  collection,
  multiple,
  index: false,
});

export const create = (
  target: TargetRef,
  fields: Record<string, FieldSpec>,
): MigrationOp => ({ op: "createEntity", target, fields });
export const add = (target: TargetRef, name: string, spec: FieldSpec): MigrationOp => ({
  op: "addField",
  target,
  name,
  spec,
});
export const dropField = (target: TargetRef, name: string): MigrationOp => ({
  op: "dropField",
  target,
  name,
});
export const renameField = (
  target: TargetRef,
  from: string,
  to: string,
): MigrationOp => ({
  op: "renameField",
  target,
  from,
  to,
});
export const alter = (
  target: TargetRef,
  name: string,
  from: FieldSpec,
  to: FieldSpec,
): MigrationOp => ({
  op: "alterField",
  target,
  name,
  from: shapeOf(from),
  to: shapeOf(to),
});
export const dropEntity = (target: TargetRef): MigrationOp => ({
  op: "dropEntity",
  target,
});
export const renameEntity = (target: TargetRef, to: string): MigrationOp => ({
  op: "renameEntity",
  target,
  to,
});

/**
 * @param state - Anything holding a snapshot (a replay state).
 * @param target - The entity to look at.
 * @returns Its fields; throws when the entity does not exist, so a test fails loudly.
 */
export function fieldsOf(
  state: { snapshot: SchemaSnapshot },
  target: TargetRef,
): Record<string, FieldSpec> {
  const entities =
    target.kind === "collection" ? state.snapshot.collections : state.snapshot.globals;
  const entity = Object.hasOwn(entities, target.slug) ? entities[target.slug] : undefined;
  if (!entity) throw new Error(`no ${target.kind} "${target.slug}" in the snapshot`);
  return entity.fields;
}

/** posts{title,body} + tags{name}, built by replaying real ops. */
export const baseState: ReplayState = replay([
  {
    ops: [
      create(col("posts"), { title: text, body: text }),
      create(col("tags"), { name: text }),
    ],
  },
]);

/**
 * @param state - The state to apply to.
 * @param op - The op to try.
 * @returns The reason it was rejected, or `undefined` when it applied.
 */
export function reasonOf(
  state: ReplayState,
  op: MigrationOp,
): ReplayErrorReason | undefined {
  try {
    applyOp(state, op);
  } catch (error) {
    if (error instanceof ReplayError) return error.reason;
    throw error;
  }
  return undefined;
}

/**
 * @param ops - Ops that build a schema from nothing (one migration).
 * @returns The snapshot they produce, built by real replay.
 */
export function snap(...ops: MigrationOp[]): SchemaSnapshot {
  return replay([{ ops }]).snapshot;
}

/**
 * @param ops - Ops.
 * @returns Their names, in order.
 */
export const opNames = (ops: readonly MigrationOp[]) => ops.map((op) => op.op);

/**
 * @param fn - Code expected to maybe throw a `DiffHintError`.
 * @returns The error's reason, or `undefined` when nothing was thrown.
 */
export function hintReason(fn: () => unknown): DiffHintReason | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DiffHintError) return error.reason;
    throw error;
  }
  return undefined;
}

/**
 * Asserts the diff invariant: replaying the diff over `prev` lands exactly on `next`.
 * @param prev - Starting snapshot.
 * @param next - Target snapshot.
 * @param hints - Rename hints.
 * @returns The ops, for further assertions.
 */
export function expectRoundTrip(
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  hints?: RenameHints,
): MigrationOp[] {
  const { ops } = diff(prev, next, hints);
  expect(replay([{ ops }], stateOf(prev)).snapshot).toEqual(next);
  return ops;
}
