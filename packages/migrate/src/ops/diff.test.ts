import { describe, expect, it } from "vitest";

import { diff, type RenameHints } from "./diff.js";

import {
  add,
  col,
  create,
  dropEntity,
  dropField,
  expectRoundTrip,
  glob,
  indexedText,
  int,
  opNames,
  rel,
  snap,
  text,
  textarea,
} from "./test-support.js";

describe("diff: basic ops", () => {
  const prev = snap(
    create(col("posts"), { title: text, body: text, views: int }),
    create(glob("site"), { name: text }),
  );

  it("emits nothing for identical snapshots", () => {
    expect(diff(prev, structuredClone(prev))).toEqual({ ops: [], warnings: [] });
  });

  it("addField carries the full spec, index included", () => {
    const next = snap(
      create(col("posts"), { title: text, body: text, views: int, slug: indexedText }),
      create(glob("site"), { name: text }),
    );
    expect(diff(prev, next).ops).toEqual([add(col("posts"), "slug", indexedText)]);
  });

  it("dropField", () => {
    const next = snap(
      create(col("posts"), { title: text, views: int }),
      create(glob("site"), { name: text }),
    );
    expect(diff(prev, next).ops).toEqual([dropField(col("posts"), "body")]);
  });

  it("alterField carries both shapes without index", () => {
    const next = snap(
      create(col("posts"), { title: text, body: textarea, views: int }),
      create(glob("site"), { name: text }),
    );
    expect(diff(prev, next).ops).toEqual([
      {
        op: "alterField",
        target: col("posts"),
        name: "body",
        from: { type: "text" },
        to: { type: "textarea" },
      },
    ]);
  });

  it("an index-only change is a setIndex, never an alterField", () => {
    const next = snap(
      create(col("posts"), { title: indexedText, body: text, views: int }),
      create(glob("site"), { name: text }),
    );
    expect(diff(prev, next).ops).toEqual([
      { op: "setIndex", target: col("posts"), name: "title", index: true },
    ]);
  });

  it("a shape and index change on the same field emits alterField then setIndex", () => {
    const next = snap(
      create(col("posts"), {
        title: { type: "textarea", index: true },
        body: text,
        views: int,
      }),
      create(glob("site"), { name: text }),
    );
    expect(opNames(diff(prev, next).ops)).toEqual(["alterField", "setIndex"]);
    expectRoundTrip(prev, next);
  });

  it("relation changes (target, multiplicity) are alterField", () => {
    const a = snap(
      create(col("tags"), { name: text }),
      create(col("authors"), { name: text }),
      create(col("posts"), { tag: rel("tags") }),
    );
    const b = snap(
      create(col("tags"), { name: text }),
      create(col("authors"), { name: text }),
      create(col("posts"), { tag: rel("authors", true) }),
    );
    const { ops } = diff(a, b);
    expect(ops).toEqual([
      {
        op: "alterField",
        target: col("posts"),
        name: "tag",
        from: { type: "relation", collection: "tags", multiple: false },
        to: { type: "relation", collection: "authors", multiple: true },
      },
    ]);
  });

  it("createEntity and dropEntity, including globals", () => {
    const next = snap(
      create(col("posts"), { title: text, body: text, views: int }),
      create(glob("home"), { hero: text }),
    );
    expect(diff(prev, next).ops).toEqual([
      create(glob("home"), { hero: text }),
      dropEntity(glob("site")),
    ]);
    expectRoundTrip(prev, next);
  });

  it("orders groups and entities deterministically: renames, creates, per-entity field ops, drops", () => {
    const before = snap(
      create(col("b"), { x: text, y: text }),
      create(col("a"), { x: text }),
      create(col("gone"), { x: text }),
      create(col("old"), { x: text }),
    );
    const after = snap(
      create(col("b"), { x: textarea, z: text, w: text }),
      create(col("a"), { x: indexedText, extra: text }),
      create(col("new"), { x: text }),
      create(glob("g"), { x: text }),
    );
    const { ops } = diff(before, after, {
      entities: [{ kind: "collection", from: "old", to: "new" }],
      fields: [{ target: col("b"), from: "y", to: "w" }],
    });
    expect(ops.map((op) => `${op.op}:${op.target.kind}:${op.target.slug}`)).toEqual([
      "renameEntity:collection:old",
      "createEntity:global:g",
      "addField:collection:a",
      "setIndex:collection:a",
      "renameField:collection:b",
      "addField:collection:b",
      "alterField:collection:b",
      "dropEntity:collection:gone",
    ]);
    expectRoundTrip(before, after, {
      entities: [{ kind: "collection", from: "old", to: "new" }],
      fields: [{ target: col("b"), from: "y", to: "w" }],
    });
  });

  it("within one entity, field ops run in the order rename, add, alter, setIndex, drop", () => {
    const before = snap(
      create(col("p"), { a: text, b: text, c: text, d: text, e: text }),
    );
    const after = snap(
      create(col("p"), { a2: text, c: textarea, d: indexedText, e: text, n: text }),
    );
    // `b` is dropped, `a` renamed, `n` added, `c` altered, `d` indexed.
    const { ops } = diff(before, after, {
      fields: [{ target: col("p"), from: "a", to: "a2" }],
    });
    expect(
      ops.map((op) =>
        op.op === "renameField"
          ? `${op.op}:${op.from}`
          : `${op.op}:${"name" in op ? op.name : ""}`,
      ),
    ).toEqual([
      "renameField:a",
      "addField:n",
      "alterField:c",
      "setIndex:d",
      "dropField:b",
    ]);
    expectRoundTrip(before, after, {
      fields: [{ target: col("p"), from: "a", to: "a2" }],
    });
  });

  it("does not depend on key order or hint order", () => {
    const before = snap(create(col("a"), { x: text }), create(col("b"), { y: text }));
    const after = snap(create(col("c"), { x: text }), create(col("d"), { y: text }));
    const hints: RenameHints = {
      entities: [
        { kind: "collection", from: "a", to: "c" },
        { kind: "collection", from: "b", to: "d" },
      ],
    };
    const reversed: RenameHints = { entities: (hints.entities ?? []).toReversed() };
    expect(diff(before, after, hints)).toEqual(diff(before, after, reversed));
  });
});
