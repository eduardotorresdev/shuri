import { describe, expect, it } from "vitest";
import type { FieldSpec, SchemaSnapshot } from "../schema/snapshot.js";
import { diff, type RenameHints } from "./diff.js";
import { applyMigration, checkIntegrity, replay } from "./replay.js";
import { stateOf } from "./state.js";
import type { MigrationOp, TargetKind } from "./types.js";

// mulberry32: tiny, deterministic PRNG so failures reproduce from the seed alone.
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    chance: (p: number) => next() < p,
    int: (n: number) => Math.floor(next() * n),
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}
type Rng = ReturnType<typeof prng>;

const SCALARS = ["text", "textarea", "email", "boolean"] as const;

/**
 * @param rng - Source of randomness.
 * @param kind - Entity kind (globals never get an index).
 * @param collections - Slugs a relation may target.
 * @returns A random field spec.
 */
function randomSpec(
  rng: Rng,
  kind: TargetKind,
  collections: readonly string[],
): FieldSpec {
  const index = kind === "collection" && rng.chance(0.3);
  const roll = rng.int(5);
  if (roll === 0) {
    return { type: "number", kind: rng.pick(["integer", "float"] as const), index };
  }
  if (roll === 1) return { type: "select", multiple: rng.chance(0.5), index };
  if (roll === 2 && collections.length > 0) {
    return {
      type: "relation",
      collection: rng.pick(collections),
      multiple: rng.chance(0.5),
      index,
    };
  }
  return { type: rng.pick(SCALARS), index };
}

type Entities = SchemaSnapshot["collections"];

let counter = 0;
const fresh = (prefix: string) => `${prefix}${(counter += 1)}`;

function randomEntities(
  rng: Rng,
  kind: TargetKind,
  slugs: string[],
  all: string[],
): Entities {
  const entities: Entities = {};
  for (const slug of slugs) {
    const fields: Record<string, FieldSpec> = {};
    for (let i = rng.int(4); i >= 0; i -= 1) {
      fields[fresh("f")] = randomSpec(rng, kind, all);
    }
    entities[slug] = { fields };
  }
  return entities;
}

/**
 * @param rng - Source of randomness.
 * @returns Any valid snapshot, mutually-referencing collections included.
 */
function randomSnapshot(rng: Rng): SchemaSnapshot {
  const collectionSlugs = Array.from({ length: rng.int(4) }, () => fresh("c"));
  const globalSlugs = Array.from({ length: rng.int(3) }, () => fresh("g"));
  return {
    version: 1,
    collections: randomEntities(rng, "collection", collectionSlugs, collectionSlugs),
    globals: randomEntities(rng, "global", globalSlugs, collectionSlugs),
  };
}

/**
 * Derives `next` from `prev` by random edits and records the hints a developer would give for the
 * renames. Phases keep every hint valid: drops, entity renames, field edits, then creations.
 * @param rng - Source of randomness.
 * @param prev - The starting snapshot.
 * @returns The edited snapshot and the rename hints.
 */
function mutate(
  rng: Rng,
  prev: SchemaSnapshot,
): { next: SchemaSnapshot; hints: RenameHints } {
  const next = structuredClone(prev);
  const hints: Required<RenameHints> = { entities: [], fields: [] };
  const kinds: TargetKind[] = ["collection", "global"];
  const table = (kind: TargetKind) =>
    kind === "collection" ? next.collections : next.globals;

  // A: drop entities; fields that pointed at a dropped collection go with it.
  for (const kind of kinds) {
    for (const slug of Object.keys(table(kind))) {
      if (!rng.chance(0.2)) continue;
      delete table(kind)[slug];
      if (kind !== "collection") continue;
      for (const entity of [
        ...Object.values(next.collections),
        ...Object.values(next.globals),
      ]) {
        for (const [name, spec] of Object.entries(entity.fields)) {
          if (spec.type === "relation" && spec.collection === slug)
            delete entity.fields[name];
        }
      }
    }
  }
  // B: rename entities; relations follow.
  for (const kind of kinds) {
    for (const slug of Object.keys(table(kind))) {
      if (!rng.chance(0.3)) continue;
      const to = fresh("r");
      table(kind)[to] = table(kind)[slug] as never;
      delete table(kind)[slug];
      hints.entities.push({ kind, from: slug, to });
      if (kind !== "collection") continue;
      for (const entity of [
        ...Object.values(next.collections),
        ...Object.values(next.globals),
      ]) {
        for (const spec of Object.values(entity.fields)) {
          if (spec.type === "relation" && spec.collection === slug) spec.collection = to;
        }
      }
    }
  }
  // C: edit fields of surviving entities (the ones that have a counterpart in `prev`).
  const survivors = new Set(
    kinds.flatMap((kind) => Object.keys(table(kind)).map((slug) => `${kind}:${slug}`)),
  );
  const collections = Object.keys(next.collections);
  for (const kind of kinds) {
    for (const [slug, entity] of Object.entries(table(kind))) {
      if (!survivors.has(`${kind}:${slug}`)) continue;
      for (const name of Object.keys(entity.fields)) {
        const roll = rng.int(10);
        if (roll === 0) delete entity.fields[name];
        else if (roll === 1) {
          const to = fresh("n");
          entity.fields[to] = entity.fields[name] as FieldSpec;
          delete entity.fields[name];
          hints.fields.push({ target: { kind, slug }, from: name, to });
          if (rng.chance(0.5)) entity.fields[to] = randomSpec(rng, kind, collections);
        } else if (roll === 2) entity.fields[name] = randomSpec(rng, kind, collections);
        else if (roll === 3 && kind === "collection") {
          const spec = entity.fields[name] as FieldSpec;
          entity.fields[name] = { ...spec, index: !spec.index };
        }
      }
      if (rng.chance(0.4)) entity.fields[fresh("f")] = randomSpec(rng, kind, collections);
    }
  }
  // D: create entities, possibly referencing each other and the survivors.
  const created = Array.from({ length: rng.int(3) }, () => fresh("c"));
  Object.assign(
    next.collections,
    randomEntities(rng, "collection", created, [...collections, ...created]),
  );
  Object.assign(
    next.globals,
    randomEntities(rng, "global", rng.chance(0.5) ? [fresh("g")] : [], [
      ...collections,
      ...created,
    ]),
  );
  return { next, hints };
}

function sameRenames(a: MigrationOp[], b: MigrationOp[]) {
  expect(b).toEqual(a);
}

describe("diff invariant: replay(diff(a, b, hints)) == b", () => {
  it("holds for 400 seeded random pairs, with and without hints", () => {
    let withOps = 0;
    let renames = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const rng = prng(seed);
      const prev = randomSnapshot(rng);
      expect(
        checkIntegrity(prev),
        `seed ${seed}: generator made an invalid prev`,
      ).toEqual([]);
      const { next, hints } = mutate(rng, prev);
      expect(
        checkIntegrity(next),
        `seed ${seed}: generator made an invalid next`,
      ).toEqual([]);

      const result = diff(prev, next, hints);
      const landed = applyMigration(stateOf(prev), result.ops).state.snapshot;
      expect(landed, `seed ${seed} (hinted)`).toEqual(next);

      // diff is a function of the snapshots and the hint SET: shuffling hints changes nothing.
      const shuffled = {
        entities: (hints.entities ?? []).toReversed(),
        fields: (hints.fields ?? []).toReversed(),
      };
      sameRenames(result.ops, diff(prev, next, shuffled).ops);

      // Without hints a rename degrades to drop+add, but the invariant still holds.
      const plain = diff(prev, next);
      expect(
        replay([{ ops: plain.ops }], stateOf(prev)).snapshot,
        `seed ${seed} (plain)`,
      ).toEqual(next);
      // Nothing to do once there.
      expect(diff(next, next).ops, `seed ${seed}`).toEqual([]);

      if (result.ops.length > 0) withOps += 1;
      renames += result.ops.filter(
        (op) => op.op === "renameEntity" || op.op === "renameField",
      ).length;
    }
    // Guard against a generator that silently stopped exercising the interesting paths.
    expect(withOps).toBeGreaterThan(300);
    expect(renames).toBeGreaterThan(100);
  }, 30_000); // CPU-bound; generous budget for loaded parallel CI runs

  it("random pairs unrelated to each other round-trip too", () => {
    for (let seed = 1000; seed < 1200; seed += 1) {
      const rng = prng(seed);
      const a = randomSnapshot(rng);
      const b = randomSnapshot(rng);
      const landed = replay([{ ops: diff(a, b).ops }], stateOf(a)).snapshot;
      expect(landed, `seed ${seed}`).toEqual(b);
    }
  });
});
