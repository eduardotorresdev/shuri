import { describe, expect, it } from "vitest";
import { DiffHintError } from "../errors.js";
import { diff, type RenameHints } from "./diff.js";
import { replay } from "./replay.js";
import { stateOf } from "./state.js";
import {
  col,
  create,
  expectRoundTrip,
  glob,
  hintReason,
  indexedText,
  int,
  opNames,
  renameEntity,
  renameField,
  snap,
  text,
  textarea,
} from "./test-support.js";

const entityHint = (from: string, to: string): RenameHints => ({
  entities: [{ kind: "collection", from, to }],
});
const withTags = (slug: string) =>
  snap(
    create(col("posts"), { title: text, body: text }),
    create(col(slug), { name: text }),
  );

describe("diff: rename hints", () => {
  const prev = snap(
    create(col("posts"), { title: text, body: text }),
    create(col("tags"), { name: text }),
  );

  it("a hinted field rename keeps the field's lineage and emits no drop/add", () => {
    const next = snap(
      create(col("posts"), { headline: text, body: text }),
      create(col("tags"), { name: text }),
    );
    const hints = { fields: [{ target: col("posts"), from: "title", to: "headline" }] };
    const { ops, warnings } = diff(prev, next, hints);
    expect(ops).toEqual([renameField(col("posts"), "title", "headline")]);
    expect(warnings).toEqual([]);
    const start = stateOf(prev);
    const end = replay([{ ops }], start);
    expect(end.lineage.fields["collection:posts.headline"]).toBe(
      start.lineage.fields["collection:posts.title"],
    );
  });

  it("a rename that also changes shape and index is renameField + alterField + setIndex", () => {
    const next = snap(
      create(col("posts"), { headline: { type: "textarea", index: true }, body: text }),
      create(col("tags"), { name: text }),
    );
    const hints = { fields: [{ target: col("posts"), from: "title", to: "headline" }] };
    const ops = expectRoundTrip(prev, next, hints);
    expect(opNames(ops)).toEqual(["renameField", "alterField", "setIndex"]);
    expect(ops[1]).toMatchObject({
      name: "headline",
      from: { type: "text" },
      to: { type: "textarea" },
    });
  });

  it("composes: a field hint names the entity by its NEW slug", () => {
    const next = snap(
      create(col("posts"), { title: text, body: text }),
      create(col("labels"), { label: text }),
    );
    const hints: RenameHints = {
      entities: [{ kind: "collection", from: "tags", to: "labels" }],
      fields: [{ target: col("labels"), from: "name", to: "label" }],
    };
    expect(expectRoundTrip(prev, next, hints)).toEqual([
      renameEntity(col("tags"), "labels"),
      renameField(col("labels"), "name", "label"),
    ]);
    // by the old slug the entity is unknown to the new schema
    expect(
      hintReason(() =>
        diff(prev, next, {
          entities: hints.entities,
          fields: [{ target: col("tags"), from: "name", to: "label" }],
        }),
      ),
    ).toBe("source-missing");
  });

  it("chained field renames are ordered so the vacated name is free", () => {
    const before = snap(create(col("p"), { a: text, b: textarea }));
    const after = snap(create(col("p"), { b: text, c: textarea }));
    const hints: RenameHints = {
      fields: [
        { target: col("p"), from: "a", to: "b" },
        { target: col("p"), from: "b", to: "c" },
      ],
    };
    expect(expectRoundTrip(before, after, hints)).toEqual([
      renameField(col("p"), "b", "c"),
      renameField(col("p"), "a", "b"),
    ]);
  });

  it("a field swap is a cycle", () => {
    const before = snap(create(col("p"), { a: text, b: textarea }));
    const after = snap(create(col("p"), { a: textarea, b: text }));
    expect(
      hintReason(() =>
        diff(before, after, {
          fields: [
            { target: col("p"), from: "a", to: "b" },
            { target: col("p"), from: "b", to: "a" },
          ],
        }),
      ),
    ).toBe("cycle");
  });

  it.each([
    [
      "source absent from the old schema",
      () => diff(prev, withTags("labels"), entityHint("ghost", "labels")),
      "source-missing",
    ],
    [
      "source still present in the new schema",
      () =>
        diff(
          prev,
          snap(
            create(col("posts"), { title: text, body: text }),
            create(col("tags"), { name: text }),
            create(col("labels"), { name: text }),
          ),
          entityHint("tags", "labels"),
        ),
      "source-missing",
    ],
    [
      "destination absent from the new schema",
      () => diff(prev, withTags("labels"), entityHint("tags", "other")),
      "target-missing",
    ],
    [
      "destination already in the old schema",
      () =>
        diff(
          prev,
          snap(create(col("posts"), { title: text, body: text, extra: text })),
          entityHint("tags", "posts"),
        ),
      "target-missing",
    ],
    [
      "same source twice",
      () =>
        diff(prev, withTags("labels"), {
          entities: [
            { kind: "collection", from: "tags", to: "labels" },
            { kind: "collection", from: "tags", to: "other" },
          ],
        }),
      "duplicate",
    ],
    [
      "same destination twice",
      () =>
        diff(prev, withTags("labels"), {
          entities: [
            { kind: "collection", from: "tags", to: "labels" },
            { kind: "collection", from: "posts", to: "labels" },
          ],
        }),
      "duplicate",
    ],
    [
      "field: unknown source",
      () =>
        diff(
          prev,
          snap(
            create(col("posts"), { title: text, body: text, x: text }),
            create(col("tags"), { name: text }),
          ),
          { fields: [{ target: col("posts"), from: "ghost", to: "x" }] },
        ),
      "source-missing",
    ],
    [
      "field: destination not in new schema",
      () =>
        diff(
          prev,
          snap(create(col("posts"), { body: text }), create(col("tags"), { name: text })),
          { fields: [{ target: col("posts"), from: "title", to: "nope" }] },
        ),
      "target-missing",
    ],
    [
      "field: same source twice",
      () =>
        diff(
          prev,
          snap(
            create(col("posts"), { x: text, y: text }),
            create(col("tags"), { name: text }),
          ),
          {
            fields: [
              { target: col("posts"), from: "title", to: "x" },
              { target: col("posts"), from: "title", to: "y" },
            ],
          },
        ),
      "duplicate",
    ],
  ] as const)("rejects a hint with %s", (_label, run, reason) => {
    expect(hintReason(run)).toBe(reason);
  });

  it("an entity hint is scoped by kind: a collection and a global may share names", () => {
    const before = snap(create(col("x"), { a: text }), create(glob("x"), { a: text }));
    const after = snap(create(col("y"), { a: text }), create(glob("x"), { a: text }));
    expect(expectRoundTrip(before, after, entityHint("x", "y"))).toEqual([
      renameEntity(col("x"), "y"),
    ]);
  });

  it("error carries the offending hint", () => {
    const hint = { kind: "collection", from: "ghost", to: "labels" } as const;
    try {
      diff(prev, withTags("labels"), { entities: [hint] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DiffHintError);
      expect((error as DiffHintError).hint).toEqual(hint);
    }
  });
});

describe("diff: possible-rename warnings", () => {
  const before = snap(create(col("posts"), { title: text, views: int }));

  it("flags a drop and an add with the same shape in one entity", () => {
    const after = snap(create(col("posts"), { headline: text, views: int }));
    expect(diff(before, after).warnings).toEqual([
      {
        kind: "possible-rename",
        target: col("posts"),
        dropped: "title",
        added: "headline",
      },
    ]);
  });

  it("matches on shape only, so an index difference still warns", () => {
    const after = snap(create(col("posts"), { headline: indexedText, views: int }));
    expect(diff(before, after).warnings).toHaveLength(1);
  });

  it("does not warn when the shapes differ", () => {
    const after = snap(create(col("posts"), { headline: textarea, views: int }));
    expect(diff(before, after).warnings).toEqual([]);
  });

  it("does not warn across different entities", () => {
    const after = snap(
      create(col("posts"), { views: int }),
      create(col("pages"), { title: text }),
    );
    expect(diff(before, after).warnings).toEqual([]);
  });

  it("does not warn when the rename was hinted", () => {
    const after = snap(create(col("posts"), { headline: text, views: int }));
    const { warnings } = diff(before, after, {
      fields: [{ target: col("posts"), from: "title", to: "headline" }],
    });
    expect(warnings).toEqual([]);
  });
});
