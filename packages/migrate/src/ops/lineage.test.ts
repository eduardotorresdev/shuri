import { describe, expect, it } from "vitest";
import { applyMigration, applyOp, replay } from "./replay.js";
import { statesEquivalent, type ReplayState } from "./state.js";
import {
  add,
  col,
  create,
  dropEntity,
  dropField,
  int,
  renameEntity,
  renameField,
  text,
} from "./test-support.js";

describe("lineage", () => {
  const withA: ReplayState = replay([{ ops: [create(col("c"), { a: text })] }]);

  it("a rename keeps the lineage and leaves no tombstone at the source", () => {
    const { state } = applyOp(withA, renameField(col("c"), "a", "b"));
    expect(state.lineage.fields["collection:c.b"]).toBe("collection:c.a@-");
    expect(state.lineage.fields).not.toHaveProperty("collection:c.a");
    expect(state.tombstones).not.toHaveProperty("collection:c.a");
  });

  it("a drop records a tombstone and the next add of the slot mints from it", () => {
    const dropped = applyOp(withA, dropField(col("c"), "a")).state;
    expect(dropped.tombstones["collection:c.a"]).toBe("collection:c.a@-");
    const readded = applyOp(dropped, add(col("c"), "a", text)).state;
    expect(readded.lineage.fields["collection:c.a"]).toBe(
      "collection:c.a@collection:c.a@-",
    );
  });

  it("two branches adding the same field mint the same lineage", () => {
    const left = applyOp(withA, add(col("c"), "p", int)).state;
    const right = applyOp(withA, add(col("c"), "p", int)).state;
    expect(statesEquivalent(left, right)).toBe(true);
  });

  it("renameEntity moves the lineage of the entity and of all its fields", () => {
    const { state } = applyOp(withA, renameEntity(col("c"), "d"));
    expect(state.lineage.entities).toEqual({ "collection:d": "collection:c@-" });
    expect(state.lineage.fields).toEqual({ "collection:d.a": "collection:c.a@-" });
  });

  it("dropEntity tombstones the entity and every one of its fields", () => {
    const { state } = applyOp(withA, dropEntity(col("c")));
    expect(Object.keys(state.tombstones).toSorted()).toEqual([
      "collection:c",
      "collection:c.a",
    ]);
    expect(state.lineage).toEqual({ entities: {}, fields: {} });
  });

  it("separates 'rename a->b' from 'drop a + add b' even though the schemas are equal", () => {
    const renamed = applyOp(withA, renameField(col("c"), "a", "b")).state;
    const recreated = applyMigration(withA, [
      dropField(col("c"), "a"),
      add(col("c"), "b", text),
    ]).state;
    expect(renamed.snapshot).toEqual(recreated.snapshot);
    expect(statesEquivalent(renamed, recreated)).toBe(false);
  });

  it("separates 'rename entity' from 'drop entity + create entity' (plan scenario 7 at the state level)", () => {
    const tags = replay([{ ops: [create(col("tags"), { name: text })] }]);
    const renamed = applyOp(tags, renameEntity(col("tags"), "labels")).state;
    const recreated = applyMigration(tags, [
      dropEntity(col("tags")),
      create(col("labels"), { name: text }),
    ]).state;
    expect(renamed.snapshot).toEqual(recreated.snapshot);
    expect(statesEquivalent(renamed, recreated)).toBe(false);
  });

  it("a rename preserves lineage through a later alter and index change", () => {
    const { state } = applyMigration(withA, [
      renameField(col("c"), "a", "b"),
      { op: "setIndex", target: col("c"), name: "b", index: true },
      {
        op: "alterField",
        target: col("c"),
        name: "b",
        from: { type: "text" },
        to: { type: "textarea" },
      },
    ]);
    expect(state.lineage.fields["collection:c.b"]).toBe("collection:c.a@-");
  });
});
