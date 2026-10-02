import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { MigrationFile } from "../migration/types.js";
import { replay } from "../ops/replay.js";
import type { MigrationOp, TargetRef } from "../ops/types.js";
import type { FieldSpec, SchemaSnapshot } from "../schema/snapshot.js";
import { schemaFromSnapshot } from "./schema-from-snapshot.js";

// Small builders the contract suite (and tests of drivers) use to write migrations.
export const collection = (slug: string): TargetRef => ({ kind: "collection", slug });
export const global = (slug: string): TargetRef => ({ kind: "global", slug });

export const createEntity = (
  target: TargetRef,
  fields: Record<string, FieldSpec>,
): MigrationOp => ({ op: "createEntity", target, fields });

export const textSpec: FieldSpec = { type: "text", index: false };

/**
 * @param ops - One list of ops per migration, in order.
 * @returns A linear chain of migrations (ids sort in the order given).
 */
export function chainOf(...ops: MigrationOp[][]): MigrationFile[] {
  return ops.map((list, i) => ({
    format: 1,
    id: `20260101T0000${String(i + 1).padStart(5, "0")}Z_0000_step${i + 1}`,
    parent: i === 0 ? null : `20260101T0000${String(i).padStart(5, "0")}Z_0000_step${i}`,
    ops: list,
  }));
}

/**
 * @param files - A chain.
 * @returns The snapshot after the whole chain.
 */
export const snapshotAfter = (files: readonly MigrationFile[]): SchemaSnapshot =>
  replay(files).snapshot;

/**
 * @param files - A chain.
 * @param slug - A collection slug.
 * @returns The collection schema as the chain leaves it.
 */
export function collectionAfter(
  files: readonly MigrationFile[],
  slug: string,
): CollectionSchema {
  const found = schemaFromSnapshot(snapshotAfter(files)).collections.find(
    (c) => c.slug === slug,
  );
  if (!found) throw new Error(`no collection "${slug}" after the chain`);
  return found;
}

/**
 * @param files - A chain.
 * @param slug - A global slug.
 * @returns The global schema as the chain leaves it.
 */
export function globalAfter(files: readonly MigrationFile[], slug: string): GlobalSchema {
  const found = schemaFromSnapshot(snapshotAfter(files)).globals.find(
    (g) => g.slug === slug,
  );
  if (!found) throw new Error(`no global "${slug}" after the chain`);
  return found;
}
