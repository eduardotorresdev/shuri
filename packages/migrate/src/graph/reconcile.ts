import { FrozenDivergenceError, ReconcileConflictError } from "../errors.js";
import { compareIds } from "../migration/id.js";
import type { MigrationFile, MigrationId } from "../migration/types.js";
import { replay } from "../ops/replay.js";
import { EMPTY_STATE, type ReplayState } from "../ops/state.js";
import { branchesCommute } from "./commute.js";
import { buildGraph, lca, linearChain, type MigrationGraph } from "./graph.js";

export interface ReconcileOptions {
  /** Ids already in the frozen ref (e.g. `origin/main`): never moved. */
  frozen?: ReadonlySet<MigrationId>;
}

export interface ReconcilePlan {
  /** The `parent` links to rewrite, each id once. Empty when the chain is already linear. */
  rewrites: { id: MigrationId; parent: MigrationId | null }[];
  /** The linear application order after the rewrites. */
  chain: MigrationId[];
}

/**
 * @param files - Migration files.
 * @param rewrites - `parent` rewrites, as in a `ReconcilePlan`.
 * @returns Copies of the files with the new parents; files without a rewrite are returned as is.
 */
export function applyRewrites(
  files: readonly MigrationFile[],
  rewrites: ReconcilePlan["rewrites"],
): MigrationFile[] {
  const parents = new Map(rewrites.map((r) => [r.id, r.parent]));
  return files.map((file) =>
    parents.has(file.id) ? { ...file, parent: parents.get(file.id) ?? null } : file,
  );
}

interface Candidate {
  heads: [MigrationId, MigrationId];
  depth: number;
  /** Ids from the fork point (excluded) to each head. */
  paths: [MigrationId[], MigrationId[]];
  fork: MigrationId | null;
}

function candidateFor(g: MigrationGraph, h1: MigrationId, h2: MigrationId): Candidate {
  const fork = lca(g, h1, h2);
  const depth = fork === null ? 0 : g.ancestors(fork).length;
  return {
    heads: [h1, h2],
    depth,
    paths: [g.ancestors(h1).slice(depth), g.ancestors(h2).slice(depth)],
    fork,
  };
}

const sortedFirsts = (c: Candidate) =>
  [c.paths[0][0], c.paths[1][0]].toSorted(compareIds);

// Deepest fork first; ties by the lexical order of (min, max) of the first exclusive ids.
function compareCandidates(x: Candidate, y: Candidate): number {
  if (x.depth !== y.depth) return y.depth - x.depth;
  const [xMin, xMax] = sortedFirsts(x);
  const [yMin, yMax] = sortedFirsts(y);
  return compareIds(xMin, yMin) || compareIds(xMax, yMax);
}

function nextCandidate(g: MigrationGraph): Candidate {
  let best: Candidate | undefined;
  for (let i = 0; i < g.heads.length; i++) {
    for (let j = i + 1; j < g.heads.length; j++) {
      const candidate = candidateFor(g, g.heads[i], g.heads[j]);
      if (!best || compareCandidates(candidate, best) < 0) best = candidate;
    }
  }
  return best as Candidate;
}

function stateAtFork(g: MigrationGraph, fork: MigrationId | null): ReplayState {
  if (fork === null) return EMPTY_STATE;
  return replay(g.ancestors(fork).map((id) => g.byId.get(id) as MigrationFile));
}

/**
 * Plans how to turn parallel branches into one linear chain by rewriting `parent` links, so that
 * every developer who runs it on the same files (and the same frozen set) gets the same result.
 * Pure: nothing is written; the rewrites are applied in memory between iterations.
 *
 * Each round takes the two heads with the deepest common ancestor, keeps the frozen branch (or the
 * one whose first exclusive id is smaller) in place and rebases the other on top of it, provided the
 * two branches commute. Only `parent` changes, so checksums stay the same.
 * @param files - Every migration file, in any order.
 * @param opts - The frozen set.
 * @returns The rewrites and the resulting chain.
 * @throws {GraphError} If the files do not form a valid graph.
 * @throws {ReconcileConflictError} When two branches do not commute (first conflicting pair).
 * @throws {FrozenDivergenceError} When both branches are frozen.
 * @throws {ReplayError} When the final chain does not replay.
 */
export function planReconcile(
  files: readonly MigrationFile[],
  opts: ReconcileOptions = {},
): ReconcilePlan {
  const frozen = opts.frozen ?? new Set<MigrationId>();
  const originalParent = new Map(files.map((f) => [f.id, f.parent]));
  const rewritten = new Map<MigrationId, MigrationId | null>();
  let current = [...files];
  let graph = buildGraph(current);

  while (graph.heads.length > 1) {
    const { heads, paths, fork } = nextCandidate(graph);
    const frozenFlags = paths.map((path) => path.some((id) => frozen.has(id)));
    if (frozenFlags[0] && frozenFlags[1]) throw new FrozenDivergenceError(heads);
    const aIndex = frozenFlags[1]
      ? 1
      : frozenFlags[0]
        ? 0
        : compareIds(paths[0][0], paths[1][0]) < 0
          ? 0
          : 1;
    const bIndex = 1 - aIndex;
    const byId = (path: MigrationId[]) =>
      path.map((id) => graph.byId.get(id) as MigrationFile);

    const result = branchesCommute(
      stateAtFork(graph, fork),
      byId(paths[aIndex]),
      byId(paths[bIndex]),
    );
    if (!result.commutes) {
      throw new ReconcileConflictError(result, [paths[aIndex], paths[bIndex]]);
    }
    const rewrite = { id: paths[bIndex][0], parent: heads[aIndex] };
    rewritten.set(rewrite.id, rewrite.parent);
    current = applyRewrites(current, [rewrite]);
    graph = buildGraph(current);
  }

  const chain = linearChain(graph);
  replay(chain);
  return {
    rewrites: [...rewritten]
      .filter(([id, parent]) => originalParent.get(id) !== parent)
      .map(([id, parent]) => ({ id, parent })),
    chain: chain.map((f) => f.id),
  };
}
