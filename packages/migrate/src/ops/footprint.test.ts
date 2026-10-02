import { describe, expect, it } from "vitest";
import { collidingResources, footprint } from "./footprint.js";
import {
  add,
  col,
  create,
  dropEntity,
  dropField,
  glob,
  int,
  rel,
  renameEntity,
  renameField,
  text,
} from "./test-support.js";
import type { MigrationOp } from "./types.js";

const sorted = (set: ReadonlySet<string>) => [...set].toSorted();

describe("footprint", () => {
  it("createEntity writes the entity and each field, and reads the target of each relation", () => {
    const fp = footprint(create(col("posts"), { title: text, author: rel("authors") }));
    expect(sorted(fp.writes)).toEqual([
      "e:collection:posts",
      "f:collection:posts.author",
      "f:collection:posts.title",
    ]);
    expect(sorted(fp.reads)).toEqual(["rel:collection:authors"]);
  });

  it("dropEntity writes the entity, all its fields and the relations pointing at it", () => {
    expect(sorted(footprint(dropEntity(col("tags"))).writes)).toEqual([
      "e:collection:tags",
      "f:collection:tags.*",
      "rel:collection:tags",
    ]);
  });

  it("dropEntity of a global has no relation key (relations only target collections)", () => {
    expect(sorted(footprint(dropEntity(glob("site"))).writes)).toEqual([
      "e:global:site",
      "f:global:site.*",
    ]);
  });

  it("renameEntity writes source and destination, fields and relations of both", () => {
    expect(sorted(footprint(renameEntity(col("tags"), "labels")).writes)).toEqual([
      "e:collection:labels",
      "e:collection:tags",
      "f:collection:labels.*",
      "f:collection:tags.*",
      "rel:collection:labels",
      "rel:collection:tags",
    ]);
  });

  it("addField reads the entity (and the relation target) and writes the field", () => {
    const fp = footprint(add(col("posts"), "author", rel("authors")));
    expect(sorted(fp.reads)).toEqual(["e:collection:posts", "rel:collection:authors"]);
    expect(sorted(fp.writes)).toEqual(["f:collection:posts.author"]);
  });

  it("renameField writes both names", () => {
    expect(sorted(footprint(renameField(col("posts"), "a", "b")).writes)).toEqual([
      "f:collection:posts.a",
      "f:collection:posts.b",
    ]);
  });

  it("alterField reads the relation targets of both shapes", () => {
    const fp = footprint({
      op: "alterField",
      target: col("posts"),
      name: "r",
      from: { type: "relation", collection: "a", multiple: false },
      to: { type: "relation", collection: "b", multiple: false },
    });
    expect(sorted(fp.reads)).toEqual([
      "e:collection:posts",
      "rel:collection:a",
      "rel:collection:b",
    ]);
  });

  it("dropField and setIndex read the entity and write the field", () => {
    for (const op of [
      dropField(col("posts"), "x"),
      { op: "setIndex", target: col("posts"), name: "x", index: true } as MigrationOp,
    ]) {
      const fp = footprint(op);
      expect(sorted(fp.reads)).toEqual(["e:collection:posts"]);
      expect(sorted(fp.writes)).toEqual(["f:collection:posts.x"]);
    }
  });
});

const colliding = (a: MigrationOp, b: MigrationOp) =>
  collidingResources(footprint(a), footprint(b));

describe("collidingResources", () => {
  it("labels two writes to the same field", () => {
    expect(colliding(add(col("s"), "price", int), add(col("s"), "price", text))).toEqual([
      "f:collection:s.price",
    ]);
  });

  it("does not collide on different fields of the same entity (both only read the entity)", () => {
    expect(colliding(add(col("s"), "price", int), add(col("s"), "stock", int))).toEqual(
      [],
    );
  });

  it("collides a rename with an alter of the source field", () => {
    expect(
      colliding(renameField(col("s"), "title", "name"), {
        op: "alterField",
        target: col("s"),
        name: "title",
        from: { type: "text" },
        to: { type: "textarea" },
      }),
    ).toEqual(["f:collection:s.title"]);
  });

  it("collides a dropEntity with an addField into it, on the entity", () => {
    expect(colliding(dropEntity(col("tags")), add(col("tags"), "x", text))).toEqual([
      "e:collection:tags",
      "f:collection:tags.x",
    ]);
  });

  it("collides a dropEntity with a relation that targets it", () => {
    expect(
      colliding(dropEntity(col("tags")), add(col("posts"), "tag", rel("tags"))),
    ).toEqual(["rel:collection:tags"]);
  });

  it("is symmetric", () => {
    const a = renameEntity(col("tags"), "labels");
    const b = add(col("tags"), "x", text);
    expect(colliding(a, b)).toEqual(colliding(b, a));
  });

  it("does not collide across kinds that share a slug", () => {
    expect(colliding(dropEntity(col("x")), add(glob("x"), "f", text))).toEqual([]);
  });

  it("does not collide unrelated entities", () => {
    expect(colliding(dropEntity(col("tags")), add(col("posts"), "x", text))).toEqual([]);
  });
});
