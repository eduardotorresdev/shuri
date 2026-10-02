import type { FieldShape, FieldSpec } from "../schema/snapshot.js";
import { entityKey, fieldKey } from "./state.js";
import type { MigrationOp, TargetRef } from "./types.js";

export interface Footprint {
  reads: ReadonlySet<string>;
  writes: ReadonlySet<string>;
}

/** Wildcard over every field of an entity: `f:<kind>:<slug>.*`. */
const ALL_FIELDS = "*";

const e = (target: TargetRef): string => `e:${entityKey(target)}`;
const f = (target: TargetRef, name: string): string => `f:${fieldKey(target, name)}`;
const rel = (slug: string): string => `rel:collection:${slug}`;

function relationReads(specs: readonly (FieldSpec | FieldShape)[]): string[] {
  return specs.flatMap((spec) =>
    spec.type === "relation" ? [rel(spec.collection)] : [],
  );
}

/**
 * The resources an op reads and writes, used only to label a conflict with the elements involved
 * (the decision is made by replaying, never by comparing footprints).
 *
 * Resource keys: `e:<kind>:<slug>` (an entity), `f:<kind>:<slug>.<name>` (a field, or `.*` for all
 * fields of the entity) and `rel:collection:<slug>` (the relations that point at a collection).
 * @param op - A migration op.
 * @returns Its reads and writes.
 */
export function footprint(op: MigrationOp): Footprint {
  const reads: string[] = [];
  const writes: string[] = [];
  switch (op.op) {
    case "createEntity":
      writes.push(
        e(op.target),
        ...Object.keys(op.fields).map((name) => f(op.target, name)),
      );
      reads.push(...relationReads(Object.values(op.fields)));
      break;
    case "dropEntity":
      writes.push(e(op.target), f(op.target, ALL_FIELDS));
      if (op.target.kind === "collection") writes.push(rel(op.target.slug));
      break;
    case "renameEntity": {
      const to = { kind: op.target.kind, slug: op.to };
      writes.push(e(op.target), e(to), f(op.target, ALL_FIELDS), f(to, ALL_FIELDS));
      if (op.target.kind === "collection") writes.push(rel(op.target.slug), rel(op.to));
      break;
    }
    case "addField":
      reads.push(e(op.target), ...relationReads([op.spec]));
      writes.push(f(op.target, op.name));
      break;
    case "dropField":
    case "setIndex":
      reads.push(e(op.target));
      writes.push(f(op.target, op.name));
      break;
    case "renameField":
      reads.push(e(op.target));
      writes.push(f(op.target, op.from), f(op.target, op.to));
      break;
    case "alterField":
      reads.push(e(op.target), ...relationReads([op.from, op.to]));
      writes.push(f(op.target, op.name));
      break;
  }
  return { reads: new Set(reads), writes: new Set(writes) };
}

function overlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const wild = (key: string) =>
    key.endsWith(`.${ALL_FIELDS}`) ? key.slice(0, -1) : undefined;
  const prefixA = wild(a);
  const prefixB = wild(b);
  return (
    (prefixA !== undefined && b.startsWith(prefixA)) ||
    (prefixB !== undefined && a.startsWith(prefixB))
  );
}

/**
 * The resources on which two footprints collide: one writes what the other reads or writes. A
 * wildcard overlaps every concrete field of its entity and is reported as the concrete resource.
 * @param a - Footprint of the first op.
 * @param b - Footprint of the second op.
 * @returns The colliding resource keys, sorted and unique; empty when disjoint.
 */
export function collidingResources(a: Footprint, b: Footprint): string[] {
  const found = new Set<string>();
  const scan = (writes: ReadonlySet<string>, others: Iterable<string>) => {
    for (const w of writes) {
      for (const o of others) {
        if (overlaps(w, o)) found.add(w.endsWith(`.${ALL_FIELDS}`) ? o : w);
      }
    }
  };
  scan(a.writes, [...b.reads, ...b.writes]);
  scan(b.writes, a.reads);
  return [...found].toSorted();
}
