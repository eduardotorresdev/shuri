import { describe, expect, it } from "vitest";
import { applyOp, checkIntegrity, replay } from "./replay.js";
import { EMPTY_STATE } from "./state.js";
import {
  baseState as base,
  col,
  create,
  fieldsOf,
  dropEntity,
  glob,
  rel,
  reasonOf,
  renameEntity,
  text,
  textarea,
} from "./test-support.js";

describe("applyOp: ensure semantics for entities", () => {
  describe("createEntity", () => {
    it("applies when the entity does not exist", () => {
      const result = applyOp(EMPTY_STATE, create(col("a"), { x: text }));
      expect(result.effect).toBe("applied");
      expect(result.state.snapshot.collections.a).toEqual({ fields: { x: text } });
    });

    it("is a noop when it exists with identical fields (key order aside)", () => {
      const result = applyOp(base, create(col("tags"), { name: text }));
      expect(result.effect).toBe("noop");
      expect(result.state).toBe(base);
    });

    it("errors when it exists with different fields", () => {
      expect(reasonOf(base, create(col("tags"), { name: textarea }))).toBe(
        "entity-exists-different",
      );
      expect(reasonOf(base, create(col("tags"), { name: text, extra: text }))).toBe(
        "entity-exists-different",
      );
    });

    it("keeps collections and globals with the same slug apart", () => {
      const result = applyOp(base, create(glob("tags"), { name: text }));
      expect(result.effect).toBe("applied");
      expect(Object.keys(result.state.snapshot.globals)).toEqual(["tags"]);
    });
  });

  describe("dropEntity", () => {
    it("applies when the entity exists, removing it and its lineage", () => {
      const { state, effect } = applyOp(base, dropEntity(col("tags")));
      expect(effect).toBe("applied");
      expect(state.snapshot.collections).not.toHaveProperty("tags");
      expect(state.lineage.entities).not.toHaveProperty("collection:tags");
      expect(state.lineage.fields).not.toHaveProperty("collection:tags.name");
    });

    it("is a noop when the entity is already gone", () => {
      expect(applyOp(base, dropEntity(col("ghost"))).effect).toBe("noop");
    });
  });

  describe("renameEntity", () => {
    it("applies when the source exists and the destination does not", () => {
      const { state, effect } = applyOp(base, renameEntity(col("tags"), "labels"));
      expect(effect).toBe("applied");
      expect(state.snapshot.collections.labels).toEqual({ fields: { name: text } });
      expect(state.snapshot.collections).not.toHaveProperty("tags");
    });

    it("rewrites every relation pointing at the renamed collection, in collections and globals", () => {
      const withRelations = replay([
        {
          ops: [
            create(col("tags"), { name: text }),
            create(col("posts"), {
              tag: rel("tags"),
              others: rel("tags", true),
              plain: text,
            }),
            create(glob("site"), { featured: rel("tags") }),
          ],
        },
      ]);
      const { state } = applyOp(withRelations, renameEntity(col("tags"), "labels"));
      expect(fieldsOf(state, col("posts"))).toEqual({
        tag: rel("labels"),
        others: rel("labels", true),
        plain: text,
      });
      expect(fieldsOf(state, glob("site")).featured).toEqual(rel("labels"));
      expect(checkIntegrity(state.snapshot)).toEqual([]);
    });

    it("does not touch relations when a global is renamed", () => {
      const withGlobal = applyOp(base, create(glob("site"), { x: text })).state;
      const { state } = applyOp(withGlobal, renameEntity(glob("site"), "settings"));
      expect(Object.keys(state.snapshot.globals)).toEqual(["settings"]);
    });

    it("is a noop when only the destination exists", () => {
      const renamed = applyOp(base, renameEntity(col("tags"), "labels")).state;
      expect(applyOp(renamed, renameEntity(col("tags"), "labels")).effect).toBe("noop");
    });

    it("errors when both exist or neither does", () => {
      expect(reasonOf(base, renameEntity(col("tags"), "posts"))).toBe(
        "rename-both-exist",
      );
      expect(reasonOf(base, renameEntity(col("ghost"), "phantom"))).toBe(
        "rename-neither-exists",
      );
    });
  });
});
