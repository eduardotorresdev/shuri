// Integration: two developers branch from the same migrations; reconcile turns the branches into
// one chain (graph part of plan section 15, scenarios 1-12). Only real graph/replay/checksum code.
import { describe, expect, it } from "vitest";
import { FrozenDivergenceError, ReconcileConflictError } from "../errors.js";
import {
  applyRewrites,
  planReconcile,
  type ReconcileOptions,
} from "../graph/reconcile.js";
import { checksumOf } from "../migration/checksum.js";
import { idAt, mig } from "../migration/test-support.js";
import type { MigrationFile } from "../migration/types.js";
import { replay } from "../ops/replay.js";
import {
  add,
  alter,
  col,
  create,
  dropEntity,
  dropField,
  fieldsOf,
  int,
  renameEntity,
  renameField,
  text,
  textarea,
} from "../ops/test-support.js";

const services = col("services");
const tags = col("tags");
const root = mig(idAt(1, "init"), null, [
  create(services, { title: text }),
  create(tags, { name: text }),
]);

// The state a database ends in after running the reconciled chain.
function finalState(files: readonly MigrationFile[]) {
  const plan = planReconcile(files);
  const byId = new Map(applyRewrites(files, plan.rewrites).map((f) => [f.id, f]));
  return replay(plan.chain.map((id) => byId.get(id) as MigrationFile));
}

function conflictOf(files: MigrationFile[], opts?: ReconcileOptions) {
  try {
    planReconcile(files, opts);
  } catch (error) {
    if (error instanceof ReconcileConflictError) return error;
    throw error;
  }
  throw new Error("expected a ReconcileConflictError");
}

const resources = (error: ReconcileConflictError) => [
  ...new Set(error.result.conflicts.map((c) => c.resource)),
];

// Seeded shuffle so the permutations are reproducible.
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("two developers, parallel branches", () => {
  it("1. different fields: the later branch is rebased, the chain is linear and checksums do not change", async () => {
    const a = mig(idAt(2, "price"), root.id, [add(services, "price", int)]);
    const b = mig(idAt(3, "stock"), root.id, [add(services, "stock", int)]);
    const plan = planReconcile([root, b, a]);
    expect(plan.rewrites).toEqual([{ id: b.id, parent: a.id }]);
    expect(plan.chain).toEqual([root.id, a.id, b.id]);

    const rebased = applyRewrites([root, a, b], plan.rewrites);
    expect(rebased[2].parent).toBe(a.id);
    expect(await checksumOf(rebased[2])).toBe(await checksumOf(b));
    expect(Object.keys(fieldsOf(finalState([root, a, b]), services))).toEqual([
      "title",
      "price",
      "stock",
    ]);
  });

  it("2. the same field added identically on both branches commutes and ends up once", () => {
    const op = [add(services, "price", int)];
    const files = [root, mig(idAt(2, "a"), root.id, op), mig(idAt(3, "b"), root.id, op)];
    const plan = planReconcile(files);
    expect(plan.rewrites).toEqual([{ id: idAt(3, "b"), parent: idAt(2, "a") }]);
    expect(fieldsOf(finalState(files), services).price).toEqual(int);
  });

  it("3. the same field with different types conflicts on that field", () => {
    const error = conflictOf([
      root,
      mig(idAt(2), root.id, [add(services, "price", int)]),
      mig(idAt(3), root.id, [add(services, "price", text)]),
    ]);
    expect(resources(error)).toEqual(["f:collection:services.price"]);
    expect(error.format()).toContain("resource f:collection:services.price");
  });

  it("4. renameField on one branch vs alterField on the same field conflicts", () => {
    const error = conflictOf([
      root,
      mig(idAt(2, "rename_title"), root.id, [renameField(services, "title", "name")]),
      mig(idAt(3, "alter_title"), root.id, [alter(services, "title", text, textarea)]),
    ]);
    expect(resources(error)).toContain("f:collection:services.title");
    expect(error.format()).toContain("A[0] renameField title→name");
    expect(error.format()).toContain("B[0] alterField title text→textarea");
  });

  it("5. dropEntity on one branch vs addField on that entity conflicts", () => {
    const error = conflictOf([
      root,
      mig(idAt(2), root.id, [dropEntity(tags)]),
      mig(idAt(3), root.id, [add(tags, "color", text)]),
    ]);
    expect(error.result.reason).toBe("replay-error");
    expect(error.result).toMatchObject({
      error: { reason: "entity-missing", op: { op: "addField", name: "color" } },
    });
    expect(resources(error)).toContain("e:collection:tags");
    expect(error.format()).toContain("A[0] dropEntity");
    expect(error.format()).toContain("B[0] addField color");
  });

  it("6. rename a->b vs drop a + add b (same spec) conflicts by lineage", () => {
    const withA = mig(idAt(2, "with_a"), root.id, [add(services, "a", text)]);
    const error = conflictOf([
      root,
      withA,
      mig(idAt(3, "rename"), withA.id, [renameField(services, "a", "b")]),
      mig(idAt(4, "drop_add"), withA.id, [
        dropField(services, "a"),
        add(services, "b", text),
      ]),
    ]);
    expect(error.result.reason).toBe("divergent");
    expect(resources(error)).toContain("f:collection:services.a");
  });

  it("7. renameEntity tags->labels vs dropEntity tags + createEntity labels conflicts", () => {
    const error = conflictOf([
      root,
      mig(idAt(2, "rename"), root.id, [renameEntity(tags, "labels")]),
      mig(idAt(3, "recreate"), root.id, [
        dropEntity(tags),
        create(col("labels"), { name: text }),
      ]),
    ]);
    expect(error.result.reason).toBe("divergent");
    expect(resources(error)).toContain("e:collection:tags");
  });

  it("8. three disjoint heads are chained by the first exclusive id", () => {
    const [x, y, z] = [2, 3, 4].map((n) =>
      mig(idAt(n), root.id, [add(services, `f${n}`, int)]),
    );
    const plan = planReconcile([z, y, root, x]);
    expect(plan.chain).toEqual([root.id, x.id, y.id, z.id]);
    expect(plan.rewrites).toEqual([
      { id: y.id, parent: x.id },
      { id: z.id, parent: y.id },
    ]);
  });

  it("9. nested forks: the deepest fork is resolved first, then the shallow one", () => {
    // root -> W ; root -> X -> {Y, Z}. W < X lexically, so X is rebased onto W after Y/Z are chained.
    const w = mig(idAt(2, "w"), root.id, [add(services, "w", int)]);
    const x = mig(idAt(3, "x"), root.id, [add(services, "x", int)]);
    const y = mig(idAt(4, "y"), x.id, [add(services, "y", int)]);
    const z = mig(idAt(5, "z"), x.id, [add(services, "z", int)]);
    const plan = planReconcile([root, w, x, y, z]);
    expect(plan.rewrites).toEqual([
      { id: z.id, parent: y.id },
      { id: x.id, parent: w.id },
    ]);
    expect(plan.chain).toEqual([root.id, w.id, x.id, y.id, z.id]);
  });

  it("10. two roots are branches of the virtual root", () => {
    const r1 = mig(idAt(1, "r1"), null, [create(services, { title: text })]);
    const r2 = mig(idAt(2, "r2"), null, [create(tags, { name: text })]);
    const plan = planReconcile([r2, r1]);
    expect(plan.rewrites).toEqual([{ id: r2.id, parent: r1.id }]);
    expect(plan.chain).toEqual([r1.id, r2.id]);
  });

  it("10b. two roots that create the same entity differently conflict", () => {
    const error = conflictOf([
      mig(idAt(1), null, [create(services, { title: text })]),
      mig(idAt(2), null, [create(services, { title: int })]),
    ]);
    expect(resources(error)).toContain("e:collection:services");
  });

  it("11. the plan does not depend on the order the files were read in (50 permutations)", () => {
    const files = [
      root,
      mig(idAt(2, "w"), root.id, [add(services, "w", int)]),
      mig(idAt(3, "x"), root.id, [add(services, "x", int)]),
      mig(idAt(4, "y"), idAt(3, "x"), [add(services, "y", int)]),
      mig(idAt(5, "z"), idAt(3, "x"), [add(services, "z", int)]),
      mig(idAt(6, "v"), root.id, [add(tags, "v", int)]),
    ];
    const expected = planReconcile(files);
    expect(expected.rewrites.length).toBeGreaterThan(1);
    for (let seed = 1; seed <= 50; seed++) {
      expect(planReconcile(shuffled(files, seed))).toEqual(expected);
    }
  });

  describe("12. frozen migrations", () => {
    const inMain = mig(idAt(9, "in_main"), root.id, [add(services, "late", int)]);
    const mine = mig(idAt(2, "mine"), root.id, [add(services, "early", int)]);

    it("the frozen branch is never rebased, even when its id is larger", () => {
      const plan = planReconcile([root, mine, inMain], {
        frozen: new Set([root.id, inMain.id]),
      });
      expect(plan.rewrites).toEqual([{ id: mine.id, parent: inMain.id }]);
      expect(plan.chain).toEqual([root.id, inMain.id, mine.id]);
    });

    it("without a frozen set the smaller id wins (control)", () => {
      expect(planReconcile([root, mine, inMain]).rewrites).toEqual([
        { id: inMain.id, parent: mine.id },
      ]);
    });

    it("both branches frozen: FrozenDivergenceError", () => {
      expect(() =>
        planReconcile([root, mine, inMain], {
          frozen: new Set([root.id, mine.id, inMain.id]),
        }),
      ).toThrow(FrozenDivergenceError);
    });
  });
});
