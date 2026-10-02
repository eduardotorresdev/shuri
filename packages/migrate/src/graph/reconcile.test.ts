import { describe, expect, it } from "vitest";
import {
  FrozenDivergenceError,
  GraphError,
  ReconcileConflictError,
  ReplayError,
} from "../errors.js";
import { idAt, mig } from "../migration/test-support.js";
import { add, col, create, int, text } from "../ops/test-support.js";
import { buildGraph, linearChain } from "./graph.js";
import { applyRewrites, planReconcile } from "./reconcile.js";

const services = col("services");
const [root, a, b, c, d] = [1, 2, 3, 4, 5].map((n) => idAt(n));
const seed = mig(root, null, [create(services, { title: text })]);
const addInt = (id: string, parent: string | null, name: string) =>
  mig(id, parent, [add(services, name, int)]);

const errorOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
};

describe("planReconcile", () => {
  it("returns an empty plan for an already linear chain", () => {
    const plan = planReconcile([addInt(b, a, "y"), seed, addInt(a, root, "x")]);
    expect(plan).toEqual({ rewrites: [], chain: [root, a, b] });
  });

  it("returns an empty plan and chain for no files", () => {
    expect(planReconcile([])).toEqual({ rewrites: [], chain: [] });
  });

  it("rebases the branch with the larger first id on top of the other", () => {
    const plan = planReconcile([seed, addInt(a, root, "x"), addInt(b, root, "y")]);
    expect(plan.rewrites).toEqual([{ id: b, parent: a }]);
    expect(plan.chain).toEqual([root, a, b]);
  });

  it("rebases a whole branch by rewriting only its first migration", () => {
    const files = [seed, addInt(a, root, "x"), addInt(b, root, "y"), addInt(c, b, "z")];
    const plan = planReconcile(files);
    expect(plan.rewrites).toEqual([{ id: b, parent: a }]);
    expect(plan.chain).toEqual([root, a, b, c]);
  });

  it("is idempotent: planning again over the rewritten files changes nothing", () => {
    const files = [
      seed,
      addInt(a, root, "x"),
      addInt(b, root, "y"),
      addInt(c, root, "z"),
    ];
    const first = planReconcile(files);
    const second = planReconcile(applyRewrites(files, first.rewrites));
    expect(second.rewrites).toEqual([]);
    expect(second.chain).toEqual(first.chain);
  });

  it("does not mutate the input files", () => {
    const files = [seed, addInt(a, root, "x"), addInt(b, root, "y")];
    const snapshot = structuredClone(files);
    planReconcile(files);
    expect(files).toEqual(snapshot);
  });

  it("propagates graph errors", () => {
    const error = errorOf(() => planReconcile([seed, mig(a, c)]));
    expect(error).toBeInstanceOf(GraphError);
  });

  it("throws ReconcileConflictError naming the branches when they do not commute", () => {
    const error = errorOf(() =>
      planReconcile([
        seed,
        mig(a, root, [add(services, "price", int)]),
        mig(b, root, [add(services, "price", text)]),
      ]),
    ) as ReconcileConflictError;
    expect(error).toBeInstanceOf(ReconcileConflictError);
    expect(error.name).toBe("ReconcileConflictError");
    expect(error.branches).toEqual([[a], [b]]);
    expect(error.result.reason).toBe("replay-error");
    expect(error.message).toBe(error.format());
  });

  it("stops at the first conflicting pair, deepest fork first", () => {
    // root -> X -> {Y, Z} conflict; root -> W is harmless. The deep pair is judged first.
    const [w, x, y, z] = [a, b, c, d];
    const error = errorOf(() =>
      planReconcile([
        seed,
        addInt(w, root, "w"),
        addInt(x, root, "x"),
        mig(y, x, [add(services, "clash", int)]),
        mig(z, x, [add(services, "clash", text)]),
      ]),
    ) as ReconcileConflictError;
    expect(error.branches).toEqual([[y], [z]]);
  });

  it("throws FrozenDivergenceError when both branches are frozen", () => {
    const error = errorOf(() =>
      planReconcile([seed, addInt(a, root, "x"), addInt(b, root, "y")], {
        frozen: new Set([root, a, b]),
      }),
    ) as FrozenDivergenceError;
    expect(error).toBeInstanceOf(FrozenDivergenceError);
    expect(error.heads).toEqual([a, b]);
  });

  it("frozen means 'in the ref', so a frozen shared root does not freeze the branches", () => {
    const plan = planReconcile([seed, addInt(a, root, "x"), addInt(b, root, "y")], {
      frozen: new Set([root]),
    });
    expect(plan.rewrites).toEqual([{ id: b, parent: a }]);
  });

  it("fails when the resulting chain does not replay", () => {
    // a single linear chain whose second migration is invalid on its own
    const bad = mig(a, root, [add(col("missing"), "x", int)]);
    expect(errorOf(() => planReconcile([seed, bad]))).toBeInstanceOf(ReplayError);
  });
});

describe("applyRewrites", () => {
  it("returns copies with the new parents and leaves the rest untouched", () => {
    const files = [seed, addInt(a, root, "x"), addInt(b, root, "y")];
    const out = applyRewrites(files, [{ id: b, parent: a }]);
    expect(out.map((f) => f.parent)).toEqual([null, root, a]);
    expect(files[2].parent).toBe(root);
    expect(out[0]).toBe(files[0]);
  });

  it("can set a parent back to null", () => {
    const out = applyRewrites([addInt(a, root, "x")], [{ id: a, parent: null }]);
    expect(out[0].parent).toBeNull();
    expect(linearChain(buildGraph(out)).map((f) => f.id)).toEqual([a]);
  });
});
