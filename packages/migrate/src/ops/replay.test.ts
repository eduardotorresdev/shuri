import { describe, expect, it } from "vitest";
import { applyOp } from "./replay.js";
import { EMPTY_STATE } from "./state.js";
import {
  add,
  baseState as base,
  col,
  create,
  dropField,
  fieldsOf,
  indexedText,
  int,
  reasonOf,
  renameEntity,
  renameField,
  text,
  textarea,
} from "./test-support.js";
import type { MigrationOp } from "./types.js";

const alter = (from: object, to: object): MigrationOp =>
  ({ op: "alterField", target: col("posts"), name: "title", from, to }) as MigrationOp;

const set = (index: boolean, name = "title", target = col("posts")): MigrationOp => ({
  op: "setIndex",
  target,
  name,
  index,
});

describe("applyOp: ensure semantics, one row of the table per case", () => {
  describe("addField", () => {
    it("applies when the field is absent", () => {
      const { state, effect } = applyOp(base, add(col("posts"), "views", int));
      expect(effect).toBe("applied");
      expect(fieldsOf(state, col("posts")).views).toEqual(int);
    });

    it("is a noop when present with an identical full spec, index included", () => {
      expect(applyOp(base, add(col("posts"), "title", text)).effect).toBe("noop");
    });

    it("errors when present with a different spec, even only by index", () => {
      expect(reasonOf(base, add(col("posts"), "title", textarea))).toBe(
        "field-exists-different",
      );
      expect(reasonOf(base, add(col("posts"), "title", indexedText))).toBe(
        "field-exists-different",
      );
    });

    it("errors when the entity is missing", () => {
      expect(reasonOf(base, add(col("ghost"), "x", text))).toBe("entity-missing");
    });
  });

  describe("dropField", () => {
    it("applies when the field is present", () => {
      const { state, effect } = applyOp(base, dropField(col("posts"), "body"));
      expect(effect).toBe("applied");
      expect(fieldsOf(state, col("posts"))).toEqual({ title: text });
    });

    it("is a noop when the field is absent, or the entity is", () => {
      expect(applyOp(base, dropField(col("posts"), "nope")).effect).toBe("noop");
      expect(applyOp(base, dropField(col("ghost"), "nope")).effect).toBe("noop");
    });
  });

  describe("renameField", () => {
    it("applies when the source exists and the destination does not", () => {
      const { state, effect } = applyOp(
        base,
        renameField(col("posts"), "body", "content"),
      );
      expect(effect).toBe("applied");
      expect(Object.keys(fieldsOf(state, col("posts")))).toEqual(["title", "content"]);
    });

    it("is a noop when only the destination exists", () => {
      const renamed = applyOp(base, renameField(col("posts"), "body", "content")).state;
      expect(applyOp(renamed, renameField(col("posts"), "body", "content")).effect).toBe(
        "noop",
      );
    });

    it("errors when both exist, neither exists, or the entity is missing", () => {
      expect(reasonOf(base, renameField(col("posts"), "body", "title"))).toBe(
        "rename-both-exist",
      );
      expect(reasonOf(base, renameField(col("posts"), "a", "b"))).toBe(
        "rename-neither-exists",
      );
      expect(reasonOf(base, renameField(col("ghost"), "a", "b"))).toBe("entity-missing");
    });
  });

  describe("alterField", () => {
    const onIndexed = applyOp(base, {
      op: "setIndex",
      target: col("posts"),
      name: "title",
      index: true,
    }).state;

    it("applies when the field has the `from` shape, and preserves the index", () => {
      const { state, effect } = applyOp(
        onIndexed,
        alter({ type: "text" }, { type: "textarea" }),
      );
      expect(effect).toBe("applied");
      expect(fieldsOf(state, col("posts")).title).toEqual({
        type: "textarea",
        index: true,
      });
    });

    it("is a noop when the field already has the `to` shape", () => {
      expect(applyOp(base, alter({ type: "textarea" }, { type: "text" })).effect).toBe(
        "noop",
      );
    });

    it("errors when the field is in neither shape, is missing, or its entity is", () => {
      expect(reasonOf(base, alter({ type: "email" }, { type: "textarea" }))).toBe(
        "alter-shape-mismatch",
      );
      expect(
        reasonOf(base, {
          ...alter({ type: "text" }, { type: "email" }),
          name: "nope",
        } as MigrationOp),
      ).toBe("field-missing");
      expect(
        reasonOf(base, {
          ...alter({ type: "text" }, { type: "email" }),
          target: col("ghost"),
        } as MigrationOp),
      ).toBe("entity-missing");
    });
  });

  describe("setIndex", () => {
    it("applies when the value differs", () => {
      const { state, effect } = applyOp(base, set(true));
      expect(effect).toBe("applied");
      expect(fieldsOf(state, col("posts")).title).toEqual(indexedText);
    });

    it("is a noop when the value is the same", () => {
      expect(applyOp(base, set(false)).effect).toBe("noop");
    });

    it("errors when the field or entity is missing", () => {
      expect(reasonOf(base, set(true, "nope"))).toBe("field-missing");
      expect(reasonOf(base, set(true, "title", col("ghost")))).toBe("entity-missing");
    });
  });

  it("never mutates the state it was given", () => {
    const before = structuredClone(base);
    applyOp(base, renameEntity(col("tags"), "labels"));
    applyOp(base, dropField(col("posts"), "title"));
    applyOp(base, add(col("posts"), "z", text));
    expect(base).toEqual(before);
  });

  it("handles names that collide with Object.prototype members", () => {
    const { state } = applyOp(
      applyOp(EMPTY_STATE, create(col("constructor"), { toString: text })).state,
      add(col("constructor"), "valueOf", text),
    );
    expect(Object.keys(fieldsOf(state, col("constructor")))).toEqual([
      "toString",
      "valueOf",
    ]);
    expect(reasonOf(EMPTY_STATE, add(col("constructor"), "x", text))).toBe(
      "entity-missing",
    );
  });
});
