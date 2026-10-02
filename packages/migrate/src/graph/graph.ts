import { GraphError, MultipleHeadsError } from "../errors.js";
import { compareIds } from "../migration/id.js";
import type { MigrationFile, MigrationId } from "../migration/types.js";

export interface MigrationGraph {
  readonly byId: ReadonlyMap<MigrationId, MigrationFile>;
  /** Migrations with `parent: null`, sorted. */
  readonly roots: readonly MigrationId[];
  /** Migrations nobody names as `parent`, sorted. */
  readonly heads: readonly MigrationId[];
  /** Direct children of `id`, sorted. */
  children(id: MigrationId): readonly MigrationId[];
  /** The path from a root down to `id`, both included. */
  ancestors(id: MigrationId): readonly MigrationId[];
}

function unknownId(id: MigrationId): never {
  throw new RangeError(`unknown migration id ${id}`);
}

// Ids that sit on a cycle of `parent` links (every parent is known at this point).
function idsOnCycles(byId: ReadonlyMap<MigrationId, MigrationFile>): MigrationId[] {
  const settled = new Set<MigrationId>();
  const onCycle = new Set<MigrationId>();
  for (const start of byId.keys()) {
    const walk: MigrationId[] = [];
    const position = new Map<MigrationId, number>();
    let current: MigrationId | null = start;
    while (current !== null && !settled.has(current)) {
      const seenAt = position.get(current);
      if (seenAt !== undefined) {
        for (const id of walk.slice(seenAt)) onCycle.add(id);
        break;
      }
      position.set(current, walk.length);
      walk.push(current);
      current = (byId.get(current) as MigrationFile).parent;
    }
    for (const id of walk) settled.add(id);
  }
  return [...onCycle].toSorted(compareIds);
}

/**
 * Indexes migration files by id and `parent`.
 * @param files - The migrations, in any order.
 * @returns The graph.
 * @throws {GraphError} `duplicate` for a repeated id, `unknown-parent` for a `parent` that is not
 *   among the files, `cycle` for a `parent` loop (a self-parent included). Checked in that order.
 */
export function buildGraph(files: readonly MigrationFile[]): MigrationGraph {
  const byId = new Map<MigrationId, MigrationFile>();
  const duplicates = new Set<MigrationId>();
  for (const file of files) {
    if (byId.has(file.id)) duplicates.add(file.id);
    else byId.set(file.id, file);
  }
  if (duplicates.size > 0) {
    throw new GraphError("duplicate", [...duplicates].toSorted(compareIds));
  }
  const orphans = files.filter((f) => f.parent !== null && !byId.has(f.parent));
  if (orphans.length > 0) {
    throw new GraphError("unknown-parent", orphans.map((f) => f.id).toSorted(compareIds));
  }
  const cyclic = idsOnCycles(byId);
  if (cyclic.length > 0) throw new GraphError("cycle", cyclic);

  const childrenOf = new Map<MigrationId, MigrationId[]>();
  for (const file of files) {
    if (file.parent === null) continue;
    childrenOf.set(file.parent, [...(childrenOf.get(file.parent) ?? []), file.id]);
  }
  for (const list of childrenOf.values()) list.sort(compareIds);

  const ids = [...byId.keys()].toSorted(compareIds);
  const cache = new Map<MigrationId, readonly MigrationId[]>();
  const ancestors = (id: MigrationId): readonly MigrationId[] => {
    const hit = cache.get(id);
    if (hit) return hit;
    const file = byId.get(id) ?? unknownId(id);
    const path = file.parent === null ? [id] : [...ancestors(file.parent), id];
    cache.set(id, path);
    return path;
  };
  return {
    byId,
    roots: ids.filter((id) => (byId.get(id) as MigrationFile).parent === null),
    heads: ids.filter((id) => !childrenOf.has(id)),
    children: (id) => (byId.has(id) ? (childrenOf.get(id) ?? []) : unknownId(id)),
    ancestors,
  };
}

/**
 * The lowest common ancestor of two migrations (a migration is its own ancestor).
 * @param g - The graph.
 * @param a - One migration id.
 * @param b - Another migration id.
 * @returns The deepest migration both descend from, or `null` when they share no root (the virtual root).
 */
export function lca(
  g: MigrationGraph,
  a: MigrationId,
  b: MigrationId,
): MigrationId | null {
  const pathA = g.ancestors(a);
  const pathB = g.ancestors(b);
  let common: MigrationId | null = null;
  for (
    let i = 0;
    i < Math.min(pathA.length, pathB.length) && pathA[i] === pathB[i];
    i++
  ) {
    common = pathA[i];
  }
  return common;
}

/**
 * @param g - The graph.
 * @returns The migrations in application order, root first; `[]` for an empty graph.
 * @throws {MultipleHeadsError} If there is more than one head or root (parallel branches not yet reconciled).
 */
export function linearChain(g: MigrationGraph): MigrationFile[] {
  if (g.heads.length > 1 || g.roots.length > 1) throw new MultipleHeadsError(g.heads);
  if (g.heads.length === 0) return [];
  return g.ancestors(g.heads[0]).map((id) => g.byId.get(id) as MigrationFile);
}
