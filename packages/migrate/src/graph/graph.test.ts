import { describe, expect, it } from "vitest";
import { GraphError, MultipleHeadsError } from "../errors.js";
import { idAt, mig } from "../migration/test-support.js";
import type { MigrationFile } from "../migration/types.js";
import { buildGraph, lca, linearChain } from "./graph.js";

const [a, b, c, d, e, f] = [1, 2, 3, 4, 5, 6].map((n) => idAt(n));

const errorOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
};

describe("buildGraph", () => {
  it("indexes by id and exposes roots, heads and children sorted", () => {
    // a -> {b, c}; c -> d
    const files = [mig(d, c), mig(c, a), mig(b, a), mig(a, null)];
    const g = buildGraph(files);
    expect([...g.byId.keys()].toSorted()).toEqual([a, b, c, d]);
    expect(g.roots).toEqual([a]);
    expect(g.heads).toEqual([b, d]);
    expect(g.children(a)).toEqual([b, c]);
    expect(g.children(c)).toEqual([d]);
    expect(g.children(d)).toEqual([]);
  });

  it("does not depend on the order the files were given in", () => {
    const files = [mig(a, null), mig(b, a), mig(c, a), mig(d, b)];
    const forward = buildGraph(files);
    const backward = buildGraph(files.toReversed());
    expect(backward.heads).toEqual(forward.heads);
    expect(backward.roots).toEqual(forward.roots);
    expect(backward.children(a)).toEqual(forward.children(a));
  });

  it("supports several roots (an independent root is a branch from the virtual root)", () => {
    const g = buildGraph([mig(b, null), mig(a, null), mig(c, a)]);
    expect(g.roots).toEqual([a, b]);
    expect(g.heads).toEqual([b, c]);
  });

  it("builds an empty graph", () => {
    const g = buildGraph([]);
    expect([g.roots, g.heads]).toEqual([[], []]);
  });

  it("ancestors lists the path from the root to the id, both included", () => {
    const g = buildGraph([mig(a, null), mig(b, a), mig(c, b), mig(d, a)]);
    expect(g.ancestors(c)).toEqual([a, b, c]);
    expect(g.ancestors(a)).toEqual([a]);
    expect(g.ancestors(d)).toEqual([a, d]);
  });

  it("rejects an unknown id in ancestors/children as a programming error", () => {
    const g = buildGraph([mig(a, null)]);
    expect(() => g.ancestors(b)).toThrow(RangeError);
    expect(() => g.children(b)).toThrow(RangeError);
  });

  describe("GraphError", () => {
    it("duplicate: reports each repeated id once, sorted", () => {
      const error = errorOf(() =>
        buildGraph([mig(b, null), mig(a, null), mig(b, null), mig(b, a), mig(a, null)]),
      ) as GraphError;
      expect(error).toBeInstanceOf(GraphError);
      expect(error.name).toBe("GraphError");
      expect(error.kind).toBe("duplicate");
      expect(error.ids).toEqual([a, b]);
    });

    it("unknown-parent: reports the migrations whose parent is missing", () => {
      const error = errorOf(() =>
        buildGraph([mig(a, null), mig(c, f), mig(b, e)]),
      ) as GraphError;
      expect(error.kind).toBe("unknown-parent");
      expect(error.ids).toEqual([b, c]);
    });

    it("cycle: a self-parent is a cycle", () => {
      const error = errorOf(() => buildGraph([mig(a, null), mig(b, b)])) as GraphError;
      expect(error.kind).toBe("cycle");
      expect(error.ids).toEqual([b]);
    });

    it("cycle: lists only the migrations on the loop, not those hanging off it", () => {
      // a -> b -> c -> a is a loop; d hangs off b; e is healthy
      const error = errorOf(() =>
        buildGraph([mig(a, c), mig(b, a), mig(c, b), mig(d, b), mig(e, null)]),
      ) as GraphError;
      expect(error.kind).toBe("cycle");
      expect(error.ids).toEqual([a, b, c]);
    });

    it("reports duplicate before unknown-parent before cycle", () => {
      expect((errorOf(() => buildGraph([mig(a, f), mig(a, f)])) as GraphError).kind).toBe(
        "duplicate",
      );
      expect(
        (errorOf(() => buildGraph([mig(a, b), mig(b, a), mig(c, f)])) as GraphError).kind,
      ).toBe("unknown-parent");
    });
  });
});

describe("lca", () => {
  // root a; a -> b -> c ; b -> d ; a -> e ; separate root f
  const g = buildGraph([
    mig(a, null),
    mig(b, a),
    mig(c, b),
    mig(d, b),
    mig(e, a),
    mig(f, null),
  ]);

  it("is the deepest shared ancestor", () => {
    expect(lca(g, c, d)).toBe(b);
    expect(lca(g, c, e)).toBe(a);
  });

  it("is symmetric", () => {
    expect(lca(g, e, c)).toBe(lca(g, c, e));
  });

  it("is the node itself when one is an ancestor of the other, or both are the same", () => {
    expect(lca(g, b, c)).toBe(b);
    expect(lca(g, c, b)).toBe(b);
    expect(lca(g, c, c)).toBe(c);
  });

  it("is null (the virtual root) for migrations under different roots", () => {
    expect(lca(g, c, f)).toBeNull();
    expect(lca(g, f, a)).toBeNull();
  });
});

describe("linearChain", () => {
  it("returns the files from the root to the head", () => {
    const files: MigrationFile[] = [mig(c, b), mig(a, null), mig(b, a)];
    expect(linearChain(buildGraph(files)).map((m) => m.id)).toEqual([a, b, c]);
  });

  it("returns the very same file objects", () => {
    const first = mig(a, null);
    expect(linearChain(buildGraph([first]))[0]).toBe(first);
  });

  it("returns [] for an empty graph", () => {
    expect(linearChain(buildGraph([]))).toEqual([]);
  });

  it("throws MultipleHeadsError listing the heads when branches are parallel", () => {
    const error = errorOf(() =>
      linearChain(buildGraph([mig(a, null), mig(b, a), mig(c, a)])),
    ) as MultipleHeadsError;
    expect(error).toBeInstanceOf(MultipleHeadsError);
    expect(error.name).toBe("MultipleHeadsError");
    expect(error.heads).toEqual([b, c]);
    expect(error.message).toContain("shuri-migrate reconcile");
  });

  it("throws MultipleHeadsError for two roots", () => {
    const error = errorOf(() =>
      linearChain(buildGraph([mig(a, null), mig(b, null)])),
    ) as MultipleHeadsError;
    expect(error).toBeInstanceOf(MultipleHeadsError);
    expect(error.heads).toEqual([a, b]);
  });
});
