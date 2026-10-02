import { describe, expect, it } from "vitest";
import { ReplayError } from "../errors.js";
import { applyMigration, checkIntegrity, replay } from "./replay.js";
import type { SchemaSnapshot } from "../schema/snapshot.js";
import { EMPTY_STATE, stateOf, type ReplayState } from "./state.js";
import {
  add,
  col,
  create,
  dropEntity,
  dropField,
  fieldsOf,
  glob,
  indexedText,
  int,
  rel,
  text,
} from "./test-support.js";

const base: ReplayState = replay([
  {
    ops: [
      create(col("posts"), { title: text, body: text }),
      create(col("tags"), { name: text }),
    ],
  },
]);

describe("referential integrity is checked at the end of a migration, not per op", () => {
  it("allows two collections that reference each other in one migration", () => {
    const { state } = applyMigration(EMPTY_STATE, [
      create(col("authors"), { favourite: rel("books") }),
      create(col("books"), { author: rel("authors") }),
    ]);
    expect(checkIntegrity(state.snapshot)).toEqual([]);
  });

  it("allows dropping two collections that reference each other in one migration", () => {
    const mutual = applyMigration(EMPTY_STATE, [
      create(col("authors"), { favourite: rel("books") }),
      create(col("books"), { author: rel("authors") }),
    ]).state;
    const { state } = applyMigration(mutual, [
      dropEntity(col("authors")),
      dropEntity(col("books")),
    ]);
    expect(state.snapshot.collections).toEqual({});
  });

  it("rejects a migration that ends with a dangling relation, naming the field", () => {
    const op = create(col("books"), { author: rel("authors") });
    expect(() => applyMigration(EMPTY_STATE, [op])).toThrow(ReplayError);
    try {
      applyMigration(EMPTY_STATE, [op]);
    } catch (error) {
      const failure = error as ReplayError;
      expect(failure.reason).toBe("dangling-relation");
      expect(failure.op).toBe(op);
      expect(failure.issues).toEqual([
        'collection:books.author references unknown collection "authors"',
      ]);
    }
  });

  it("rejects dropping a collection another one still points at", () => {
    const linked = applyMigration(EMPTY_STATE, [
      create(col("authors"), { name: text }),
      create(col("books"), { author: rel("authors") }),
    ]).state;
    expect(() => applyMigration(linked, [dropEntity(col("authors"))])).toThrow(
      expect.objectContaining({ reason: "dangling-relation" }),
    );
  });

  it("rejects an indexed global field", () => {
    expect(() =>
      applyMigration(EMPTY_STATE, [create(glob("site"), { name: indexedText })]),
    ).toThrow(expect.objectContaining({ reason: "global-index" }));
    const site = applyMigration(EMPTY_STATE, [
      create(glob("site"), { name: text }),
    ]).state;
    expect(() =>
      applyMigration(site, [
        { op: "setIndex", target: glob("site"), name: "name", index: true },
      ]),
    ).toThrow(expect.objectContaining({ reason: "global-index" }));
  });

  it("does not leave the input state half-applied when a migration fails midway", () => {
    const before = structuredClone(base);
    expect(() =>
      applyMigration(base, [add(col("posts"), "z", text), add(col("ghost"), "x", text)]),
    ).toThrow(ReplayError);
    expect(base).toEqual(before);
  });

  it("reports each op's effect, in order", () => {
    const { effects } = applyMigration(base, [
      add(col("posts"), "title", text),
      add(col("posts"), "views", int),
      dropField(col("posts"), "ghost"),
    ]);
    expect(effects).toEqual(["noop", "applied", "noop"]);
  });

  it("accepts an empty migration", () => {
    expect(applyMigration(base, []).state).toEqual(base);
  });
});

describe("replay", () => {
  it("starts from EMPTY_STATE by default and folds migrations in order", () => {
    const state = replay([
      { ops: [create(col("a"), { x: text })] },
      { ops: [add(col("a"), "y", int)] },
    ]);
    expect(fieldsOf(state, col("a"))).toEqual({ x: text, y: int });
  });

  it("starts from the given base", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      collections: { a: { fields: { x: text } } },
      globals: {},
    };
    const state = replay([{ ops: [add(col("a"), "y", int)] }], stateOf(snapshot));
    expect(Object.keys(fieldsOf(state, col("a")))).toEqual(["x", "y"]);
  });

  it("propagates the failure of a later migration", () => {
    expect(() =>
      replay([
        { ops: [create(col("a"), { x: text })] },
        { ops: [add(col("b"), "y", int)] },
      ]),
    ).toThrow(expect.objectContaining({ reason: "entity-missing" }));
  });
});
