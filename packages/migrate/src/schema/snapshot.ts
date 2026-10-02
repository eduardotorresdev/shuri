import type { Field, NumberKind, ResolvedSchema } from "@shuri/core";
import { canonicalJson } from "./canonical-json.js";

export const SNAPSHOT_VERSION = 1;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What the persisted schema remembers about one field. Constraints (required, min, ...) are not here. */
export type FieldSpec =
  | { type: "text" | "textarea" | "email" | "boolean"; index: boolean }
  | { type: "number"; kind: NumberKind; index: boolean }
  | { type: "select"; multiple: boolean; index: boolean }
  | { type: "relation"; collection: string; multiple: boolean; index: boolean };

/** A field spec without its index: what a data conversion (`alterField`) depends on. */
export type FieldShape = DistributiveOmit<FieldSpec, "index">;

export interface EntitySnapshot {
  fields: Record<string, FieldSpec>;
}

export interface SchemaSnapshot {
  version: typeof SNAPSHOT_VERSION;
  collections: Record<string, EntitySnapshot>;
  globals: Record<string, EntitySnapshot>;
}

export const EMPTY_SNAPSHOT: SchemaSnapshot = Object.freeze({
  version: SNAPSHOT_VERSION,
  collections: Object.freeze({}),
  globals: Object.freeze({}),
});

/**
 * Reduces a declared field to the spec the snapshot persists.
 * Defaults: `multiple` false, `index` false. Everything else (label, hidden, required, options,
 * min/max, sign, length bounds) is deliberately ignored: no v1 driver persists it.
 * @param field - The field as declared in a collection or global.
 * @returns Its spec.
 */
export function fieldSpecOf(field: Field): FieldSpec {
  const index = field.index === true;
  switch (field.type) {
    case "number":
      return { type: "number", kind: field.kind, index };
    case "select":
      return { type: "select", multiple: field.multiple === true, index };
    case "relation":
      return {
        type: "relation",
        collection: field.collection,
        multiple: field.multiple === true,
        index,
      };
    default:
      return { type: field.type, index };
  }
}

/**
 * @param spec - A field spec.
 * @returns The same spec without `index`.
 */
export function shapeOf(spec: FieldSpec): FieldShape {
  const shape: Record<string, unknown> = { ...spec };
  delete shape.index;
  return shape as FieldShape;
}

/**
 * @param shape - A field shape.
 * @param index - Whether the field is indexed.
 * @returns The spec with that shape and index.
 */
export function withIndex(shape: FieldShape, index: boolean): FieldSpec {
  return { ...shape, index } as FieldSpec;
}

/**
 * @param a - Left value (spec, shape or snapshot).
 * @param b - Right value.
 * @returns Whether both are structurally equal, regardless of key order.
 */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function entityOf(fields: readonly Field[]): EntitySnapshot {
  return {
    fields: Object.fromEntries(fields.map((field) => [field.name, fieldSpecOf(field)])),
  };
}

/**
 * Projects a validated schema onto what the migrations track.
 * @param schema - The resolved schema of the app.
 * @returns The snapshot of its collections and globals.
 */
export function snapshotOf(schema: ResolvedSchema): SchemaSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    collections: Object.fromEntries(
      schema.collections.map((collection) => [
        collection.slug,
        entityOf(collection.fields),
      ]),
    ),
    globals: Object.fromEntries(
      schema.globals.map((global) => [global.slug, entityOf(global.fields)]),
    ),
  };
}

/**
 * @param a - Left snapshot.
 * @param b - Right snapshot.
 * @returns Whether they describe the same schema.
 */
export function snapshotsEqual(a: SchemaSnapshot, b: SchemaSnapshot): boolean {
  return structurallyEqual(a, b);
}
