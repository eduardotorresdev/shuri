import { describe, expect, it } from "vitest";
import { ReplayError } from "../errors.js";
import { idAt, mig } from "../migration/test-support.js";
import { applyMigration } from "../ops/replay.js";
import { EMPTY_STATE } from "../ops/state.js";
import {
  add,
  alter,
  col,
  create,
  dropEntity,
  glob,
  int,
  rel,
  renameEntity,
  text,
  textarea,
} from "../ops/test-support.js";
import { dependentsOf, planMigration, planSequence, realOrderOf } from "./plan.js";

const base = mig(idAt(1), null, [
  create(col("tags"), { name: text }),
  create(col("posts"), { tags: rel("tags", true), title: text }),
  create(col("notes"), { tag: rel("tags"), body: text }),
  create(glob("home"), { featured: rel("tags") }),
  create(col("loops"), { self: rel("loops") }),
]);
const baseState = applyMigration(EMPTY_STATE, base.ops).state;

describe("dependentsOf", () => {
  it("lists the collections, then the globals, that point at a collection", () => {
    expect(dependentsOf(baseState.snapshot, col("tags"))).toEqual([
      col("notes"),
      col("posts"),
      glob("home"),
    ]);
  });

  it("does not list the entity itself when it references itself", () => {
    expect(dependentsOf(baseState.snapshot, col("loops"))).toEqual([]);
  });

  it("is empty for a collection nobody references and for a global", () => {
    expect(dependentsOf(baseState.snapshot, col("posts"))).toEqual([]);
    expect(dependentsOf(baseState.snapshot, glob("home"))).toEqual([]);
  });
});

describe("planMigration", () => {
  it("reports each op's effect, so already-satisfied ops are skipped by drivers", () => {
    const file = mig(idAt(2), base.id, [
      add(col("posts"), "title", text),
      add(col("posts"), "views", int),
    ]);
    const planned = planMigration(baseState, file, "sha256:x");
    expect(planned.ops.map((p) => p.effect)).toEqual(["noop", "applied"]);
    expect(planned.id).toBe(file.id);
    expect(planned.checksum).toBe("sha256:x");
  });

  it("gives the schema before and after the whole migration", () => {
    const file = mig(idAt(2), base.id, [add(col("posts"), "views", int)]);
    const planned = planMigration(baseState, file, "c");
    expect(planned.before).toBe(baseState);
    expect(planned.before.snapshot.collections.posts.fields).not.toHaveProperty("views");
    expect(planned.after.snapshot.collections.posts.fields.views).toEqual(int);
  });

  it("computes dependents against the state just before each op", () => {
    const file = mig(idAt(2), base.id, [
      renameEntity(col("tags"), "labels"),
      add(col("labels"), "color", text),
    ]);
    const [rename, addColor] = planMigration(baseState, file, "c").ops;
    expect(rename.dependents).toEqual([col("notes"), col("posts"), glob("home")]);
    // After the rename the relations point at "labels", so the dependents follow the new name.
    expect(addColor.dependents).toEqual([col("notes"), col("posts"), glob("home")]);
  });

  it("lets mutually dependent collections go away in one migration", () => {
    const file = mig(idAt(2), base.id, [
      dropEntity(col("tags")),
      dropEntity(col("posts")),
      dropEntity(col("notes")),
      dropEntity(glob("home")),
    ]);
    expect(planMigration(baseState, file, "c").ops).toHaveLength(4);
  });

  it("throws the replay error when the migration does not apply", () => {
    const file = mig(idAt(2), base.id, [alter(col("posts"), "title", textarea, int)]);
    expect(() => planMigration(baseState, file, "c")).toThrow(ReplayError);
  });
});

const entry = (id: string) => ({
  id,
  checksum: "x",
  status: "done" as const,
  startedAt: "t",
});

describe("realOrderOf", () => {
  const [a, b, c] = [1, 2, 3].map((n) => mig(idAt(n), n === 1 ? null : idAt(n - 1)));

  it("puts journaled migrations first, in journal order, then the pending ones in chain order", () => {
    expect(realOrderOf([a, b, c], [entry(c.id)]).map((f) => f.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
  });

  it("is the chain when the journal follows it, and ignores journal ids the chain lacks", () => {
    expect(
      realOrderOf([a, b, c], [entry(a.id), entry("ghost"), entry(b.id)]).map((f) => f.id),
    ).toEqual([a.id, b.id, c.id]);
  });
});

describe("planSequence", () => {
  it("plans only the targets, each over the state the migrations before it in `order` leave", () => {
    const second = mig(idAt(2), base.id, [add(col("posts"), "views", int)]);
    const third = mig(idAt(3), second.id, [alter(col("posts"), "views", int, text)]);
    const sums = new Map([base, second, third].map((f) => [f.id, `sum-${f.id}`]));
    const planned = planSequence([base, second, third], sums, new Set([third.id]));
    expect(planned.map((p) => p.id)).toEqual([third.id]);
    expect(planned[0].checksum).toBe(`sum-${third.id}`);
    expect(planned[0].before.snapshot.collections.posts.fields.views).toEqual(int);
  });

  it("plans a migration applied out of chain order over the schema the database really has", () => {
    // Chain: base, A (adds a), B (adds b). The database ran base and B; A is pending.
    const a = mig(idAt(2, "a"), base.id, [add(col("posts"), "a", int)]);
    const b = mig(idAt(3, "b"), a.id, [add(col("posts"), "b", int)]);
    const sums = new Map([base, a, b].map((f) => [f.id, "c"]));
    const [planned] = planSequence([base, b, a], sums, new Set([a.id]));
    expect(Object.keys(planned.before.snapshot.collections.posts.fields)).toContain("b");
    expect(Object.keys(planned.after.snapshot.collections.posts.fields)).toEqual(
      expect.arrayContaining(["a", "b"]),
    );
  });
});
