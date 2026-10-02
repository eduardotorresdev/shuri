import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "../schema/snapshot.js";
import { applyOp, replay } from "./replay.js";
import { EMPTY_STATE, mintLineage, stateOf, statesEquivalent } from "./state.js";
import {
  add,
  col,
  create,
  dropField,
  fieldsOf,
  renameField,
  text,
} from "./test-support.js";

describe("mintLineage", () => {
  it("depends on the slot and its tombstone, not on the migration", () => {
    expect(mintLineage(EMPTY_STATE, "collection:a.x")).toBe("collection:a.x@-");
    const dropped = { ...EMPTY_STATE, tombstones: { "collection:a.x": "L" } };
    expect(mintLineage(dropped, "collection:a.x")).toBe("collection:a.x@L");
  });
});

describe("stateOf", () => {
  const snapshot: SchemaSnapshot = {
    version: 1,
    collections: { a: { fields: { x: text } } },
    globals: { g: { fields: { y: text } } },
  };

  it("assigns every entity and field the lineage it would have if created from nothing", () => {
    const fromSnapshot = stateOf(snapshot);
    const created = replay([
      { ops: [create(col("a"), { x: text })] },
      {
        ops: [
          {
            op: "createEntity",
            target: { kind: "global", slug: "g" },
            fields: { y: text },
          },
        ],
      },
    ]);
    expect(statesEquivalent(fromSnapshot, created)).toBe(true);
    expect(fromSnapshot.lineage.fields["global:g.y"]).toBe("global:g.y@-");
  });

  it("does not alias the snapshot it was given", () => {
    const state = stateOf(snapshot);
    fieldsOf(state, col("a")).z = text;
    expect(fieldsOf({ snapshot }, col("a"))).not.toHaveProperty("z");
  });
});

describe("statesEquivalent", () => {
  const base = replay([{ ops: [create(col("a"), { x: text })] }]);

  it("is true for the same schema reached the same way", () => {
    expect(
      statesEquivalent(base, replay([{ ops: [create(col("a"), { x: text })] }])),
    ).toBe(true);
  });

  it("is false when the schema differs", () => {
    expect(statesEquivalent(base, applyOp(base, add(col("a"), "y", text)).state)).toBe(
      false,
    );
  });

  it("is false when the schema is identical but a field has another lineage", () => {
    // `x` carried over by a rename vs `x` dropped and added back
    const viaRename = replay([
      { ops: [create(col("a"), { w: text })] },
      { ops: [renameField(col("a"), "w", "x")] },
    ]);
    const viaRecreate = replay([
      { ops: [create(col("a"), { w: text })] },
      { ops: [dropField(col("a"), "w"), add(col("a"), "x", text)] },
    ]);
    expect(viaRename.snapshot).toEqual(viaRecreate.snapshot);
    expect(statesEquivalent(viaRename, viaRecreate)).toBe(false);
  });

  it("ignores tombstones: they are history, not state", () => {
    const withTombstone = replay([
      { ops: [create(col("a"), { x: text, y: text })] },
      { ops: [dropField(col("a"), "y")] },
    ]);
    const without = replay([{ ops: [create(col("a"), { x: text })] }]);
    expect(withTombstone.tombstones).not.toEqual(without.tombstones);
    expect(statesEquivalent(withTombstone, without)).toBe(true);
  });
});
