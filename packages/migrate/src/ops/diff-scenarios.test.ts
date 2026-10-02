import { describe, expect, it } from "vitest";

import { diff, type RenameHints } from "./diff.js";
import { replay } from "./replay.js";
import { stateOf } from "./state.js";
import {
  col,
  create,
  dropEntity,
  expectRoundTrip,
  glob,
  hintReason,
  opNames,
  rel,
  renameEntity,
  snap,
  text,
} from "./test-support.js";

describe("diff: scenario 16 (relations, chains, cycles)", () => {
  it("creates two new collections with a mutual relation in one migration", () => {
    const next = snap(
      create(col("authors"), { book: rel("books") }),
      create(col("books"), { author: rel("authors") }),
    );
    const ops = expectRoundTrip(snap(), next);
    expect(opNames(ops)).toEqual(["createEntity", "createEntity"]);
  });

  it("drops two collections that reference each other", () => {
    const prev = snap(
      create(col("authors"), { book: rel("books") }),
      create(col("books"), { author: rel("authors") }),
      create(col("keep"), { x: text }),
    );
    const next = snap(create(col("keep"), { x: text }));
    const ops = expectRoundTrip(prev, next);
    expect(ops).toEqual([dropEntity(col("authors")), dropEntity(col("books"))]);
  });

  describe("chained entity renames b->c, a->b", () => {
    const prev = snap(
      create(col("a"), { fromA: text }),
      create(col("b"), { fromB: text }),
    );
    const next = snap(
      create(col("b"), { fromA: text }),
      create(col("c"), { fromB: text }),
    );
    const a = { kind: "collection", from: "a", to: "b" } as const;
    const b = { kind: "collection", from: "b", to: "c" } as const;

    it("runs the rename that vacates a name first, whatever the hint order", () => {
      for (const entities of [
        [a, b],
        [b, a],
      ]) {
        const ops = expectRoundTrip(prev, next, { entities });
        expect(ops).toEqual([renameEntity(col("b"), "c"), renameEntity(col("a"), "b")]);
      }
    });

    it("carries lineage through the chain (no drop+create in disguise)", () => {
      const { ops } = diff(prev, next, { entities: [a, b] });
      const start = stateOf(prev);
      const end = replay([{ ops }], start);
      expect(end.lineage.entities["collection:b"]).toBe(
        start.lineage.entities["collection:a"],
      );
      expect(end.lineage.entities["collection:c"]).toBe(
        start.lineage.entities["collection:b"],
      );
    });
  });

  it("rejects swapping two names (a<->b) as a cycle, in either order", () => {
    const prev = snap(create(col("a"), { x: text }), create(col("b"), { y: text }));
    const next = snap(create(col("a"), { y: text }), create(col("b"), { x: text }));
    const swap: RenameHints = {
      entities: [
        { kind: "collection", from: "a", to: "b" },
        { kind: "collection", from: "b", to: "a" },
      ],
    };
    expect(hintReason(() => diff(prev, next, swap))).toBe("cycle");
    expect(
      hintReason(() =>
        diff(prev, next, { entities: (swap.entities ?? []).toReversed() }),
      ),
    ).toBe("cycle");
  });

  it("rejects longer rotations and self-renames as cycles", () => {
    const prev = snap(create(col("a"), {}), create(col("b"), {}), create(col("c"), {}));
    const rotate: RenameHints = {
      entities: [
        { kind: "collection", from: "a", to: "b" },
        { kind: "collection", from: "b", to: "c" },
        { kind: "collection", from: "c", to: "a" },
      ],
    };
    expect(hintReason(() => diff(prev, prev, rotate))).toBe("cycle");
    expect(
      hintReason(() =>
        diff(prev, prev, { entities: [{ kind: "collection", from: "a", to: "a" }] }),
      ),
    ).toBe("cycle");
  });

  it("renaming an entity rewrites the relations of others, with no spurious alterField", () => {
    const prev = snap(
      create(col("tags"), { name: text }),
      create(col("posts"), { tags: rel("tags", true), main: rel("tags") }),
      create(glob("site"), { featured: rel("tags") }),
    );
    const next = snap(
      create(col("labels"), { name: text }),
      create(col("posts"), { tags: rel("labels", true), main: rel("labels") }),
      create(glob("site"), { featured: rel("labels") }),
    );
    const ops = expectRoundTrip(prev, next, {
      entities: [{ kind: "collection", from: "tags", to: "labels" }],
    });
    expect(ops).toEqual([renameEntity(col("tags"), "labels")]);
  });

  it("without the hint the same change is create + alter + drop (never an inferred rename)", () => {
    const prev = snap(
      create(col("tags"), { name: text }),
      create(col("posts"), { t: rel("tags") }),
    );
    const next = snap(
      create(col("labels"), { name: text }),
      create(col("posts"), { t: rel("labels") }),
    );
    const ops = expectRoundTrip(prev, next);
    expect(opNames(ops)).toEqual(["createEntity", "alterField", "dropEntity"]);
  });
});
