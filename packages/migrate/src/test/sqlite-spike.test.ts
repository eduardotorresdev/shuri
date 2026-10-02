// F5 spike: the MigrationDriver port driven by a relational engine (node:sqlite), through the real
// runner. Throwaway until F10 (`@shuri/store-d1`).
import { describe, expect, it } from "vitest";
import { DriverLimitError } from "../errors/runner.js";
import { idAt, mig } from "../migration/test-support.js";
import { convertValue } from "../ops/convert-value.js";
import {
  add,
  alter,
  col,
  create,
  int,
  rel,
  text,
  textarea,
} from "../ops/test-support.js";
import type { FieldSpec } from "../schema/snapshot.js";
import { migrateUp } from "../runner/up.js";
import {
  createSqliteSpike,
  SpikeInjectedFailure,
  SpikeUnsupportedError,
} from "./sqlite-spike-driver.js";

const posts = col("posts");
const notes = col("notes");
const real: FieldSpec = { type: "number", kind: "float", index: false };
const flag: FieldSpec = { type: "boolean", index: false };

const init = mig(idAt(1, "init"), null, [
  create(posts, { title: text, views: real }),
  create(notes, { post: rel("posts"), body: text }),
]);

const columns = (spike: ReturnType<typeof createSqliteSpike>, table: string) =>
  spike.db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((c) => [c.name, c.type]);

describe("sqlite spike: plan / render / execute through the runner", () => {
  it("createEntity: creates the tables, a foreign key for a single relation and the indexes", async () => {
    const spike = createSqliteSpike();
    const withIndex = mig(idAt(1, "init"), null, [
      create(posts, { title: { type: "text", index: true } }),
      create(notes, { post: rel("posts") }),
    ]);
    await migrateUp({ files: [withIndex], driver: spike.driver });
    expect(columns(spike, "notes")).toEqual([
      ["id", "TEXT"],
      ["post", "TEXT"],
    ]);
    expect(spike.db.prepare('PRAGMA foreign_key_list("notes")').all()).toMatchObject([
      { table: "posts", from: "post", to: "id" },
    ]);
    const indexes = spike.db
      .prepare('PRAGMA index_list("posts")')
      .all()
      .map((i) => i.name);
    expect(indexes).toContain("posts_title_idx");
  });

  it("addField: the table is rebuilt with the new column and the rows survive", async () => {
    const spike = createSqliteSpike();
    await migrateUp({ files: [init], driver: spike.driver });
    spike.db
      .prepare("INSERT INTO posts (id, title, views) VALUES ('p1', 'hello', 2.5)")
      .run();
    const addViews = mig(idAt(2, "add"), init.id, [add(posts, "slug", text)]);
    const { applied } = await migrateUp({
      files: [init, addViews],
      driver: spike.driver,
    });
    expect(applied).toEqual([addViews.id]);
    expect(columns(spike, "posts")).toEqual([
      ["id", "TEXT"],
      ["title", "TEXT"],
      ["views", "REAL"],
      ["slug", "TEXT"],
    ]);
    expect(spike.db.prepare("SELECT * FROM posts").all()).toMatchObject([
      { id: "p1", title: "hello", views: 2.5, slug: null },
    ]);
  });

  it("alterField: converts the data in SQL, in the same transaction as the journal row", async () => {
    const spike = createSqliteSpike();
    await migrateUp({ files: [init], driver: spike.driver });
    spike.db
      .prepare("INSERT INTO posts (id, title, views) VALUES ('p1', 'a', 7.9)")
      .run();
    const toInt = mig(idAt(2, "to_int"), init.id, [
      alter(posts, "views", real, int),
      alter(posts, "title", text, textarea),
    ]);
    await migrateUp({
      files: [init, toInt],
      driver: spike.driver,
      allowDestructive: "all",
    });
    expect(columns(spike, "posts")).toContainEqual(["views", "INTEGER"]);
    expect(spike.db.prepare("SELECT title, views FROM posts").all()).toMatchObject([
      { title: "a", views: 7 },
    ]);
    expect((await spike.driver.applied()).map((a) => a.id)).toEqual([init.id, toInt.id]);
  });

  it("alterField SQL agrees with convertValue on the pairs the spike implements", async () => {
    const pairs: [FieldSpec, FieldSpec, unknown[]][] = [
      [text, int, ["12", "-7", "abc", "3.5", "", " 4"]],
      [text, real, ["3.14", "-2", "1e3", ".5", "7.", "1.2.3", "x"]],
      [text, flag, ["true", "false", "TRUE", "yes"]],
      [int, text, [0, 42, -3]],
      [real, int, [3.9, -3.9, 4, -0.5]],
      [flag, text, [true, false]],
    ];
    for (const [from, to, values] of pairs) {
      const spike = createSqliteSpike();
      const create1 = mig(idAt(1), null, [create(posts, { f: from })]);
      await migrateUp({ files: [create1], driver: spike.driver });
      values.forEach((v, i) => {
        const stored = typeof v === "boolean" ? Number(v) : v;
        spike.db
          .prepare("INSERT INTO posts (id, f) VALUES (?, ?)")
          .run(`r${i}`, stored as never);
      });
      const change = mig(idAt(2), create1.id, [alter(posts, "f", from, to)]);
      await migrateUp({
        files: [create1, change],
        driver: spike.driver,
        allowDestructive: "all",
      });
      const got = spike.db
        .prepare("SELECT f FROM posts ORDER BY id")
        .all()
        .map((r) => r.f);
      const { index: _a, ...fromShape } = from;
      const { index: _b, ...toShape } = to;
      const expected = values.map((v) => {
        const converted = convertValue(v, fromShape as never, toShape as never);
        return typeof converted === "boolean" ? Number(converted) : (converted ?? null);
      });
      expect(got, `${from.type} -> ${to.type}`).toEqual(expected);
    }
  });

  it("a rebuild of a referenced table keeps the rows that point at it, and the plan lists the dependents", async () => {
    const spike = createSqliteSpike();
    await migrateUp({ files: [init], driver: spike.driver });
    spike.db.prepare("INSERT INTO posts (id, title) VALUES ('p1', 'a')").run();
    spike.db.prepare("INSERT INTO notes (id, post, body) VALUES ('n1', 'p1', 'b')").run();
    const change = mig(idAt(2, "title"), init.id, [
      alter(posts, "title", text, textarea),
    ]);
    const dry = await migrateUp({
      files: [init, change],
      driver: spike.driver,
      dryRun: true,
    });
    expect(dry.plans[0].steps[0].description).toContain("[dependents: notes]");
    await migrateUp({ files: [init, change], driver: spike.driver });
    expect(spike.db.prepare("SELECT post FROM notes").all()).toMatchObject([
      { post: "p1" },
    ]);
    expect(spike.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(spike.db.prepare("PRAGMA foreign_keys").get()).toMatchObject({
      foreign_keys: 1,
    });
  });

  it("render turns a plan into SQL a D1 migration file could hold", async () => {
    const spike = createSqliteSpike();
    await migrateUp({ files: [init], driver: spike.driver });
    const change = mig(idAt(2, "to_int"), init.id, [alter(posts, "views", real, int)]);
    const { plans } = await migrateUp({
      files: [init, change],
      driver: spike.driver,
      dryRun: true,
    });
    const sql = spike.driver.render?.(plans[0]) ?? "";
    expect(sql).toMatch(
      /^-- alterField views number\(float\)→number\(integer\) in collection posts/,
    );
    expect(sql).toContain('CREATE TABLE "_rebuild_posts"');
    expect(sql).toContain('DROP TABLE "posts";');
    expect(sql).toContain('ALTER TABLE "_rebuild_posts" RENAME TO "posts";');
    expect(spike.driver.capabilities).toEqual({
      atomicity: "migration",
      transactionalJournal: true,
      render: true,
    });
    // A dry run changes nothing.
    expect(columns(spike, "posts")).toContainEqual(["views", "REAL"]);
  });

  it("a failure halfway through a rebuild rolls back the schema, the data and the journal", async () => {
    const spike = createSqliteSpike();
    await migrateUp({ files: [init], driver: spike.driver });
    spike.db
      .prepare("INSERT INTO posts (id, title, views) VALUES ('p1', 'a', 1.5)")
      .run();
    const change = mig(idAt(2, "to_int"), init.id, [alter(posts, "views", real, int)]);
    spike.injectFailure(3); // after DROP TABLE, before the rename: the worst moment
    await expect(
      migrateUp({ files: [init, change], driver: spike.driver, allowDestructive: "all" }),
    ).rejects.toThrow(SpikeInjectedFailure);
    expect(columns(spike, "posts")).toContainEqual(["views", "REAL"]);
    expect(spike.db.prepare("SELECT * FROM posts").all()).toMatchObject([
      { id: "p1", views: 1.5 },
    ]);
    expect(
      spike.db
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE '_rebuild%'")
        .all(),
    ).toEqual([]);
    expect((await spike.driver.applied()).map((a) => a.id)).toEqual([init.id]);
    // And running again succeeds.
    await migrateUp({
      files: [init, change],
      driver: spike.driver,
      allowDestructive: "all",
    });
    expect(spike.db.prepare("SELECT views FROM posts").all()).toMatchObject([
      { views: 1 },
    ]);
  });

  it("validateSnapshot reports the engine's column limit before anything runs", async () => {
    const spike = createSqliteSpike({ maxColumns: 3 });
    const wide = mig(idAt(1), null, [create(posts, { a: text, b: text, c: text })]);
    await expect(migrateUp({ files: [wide], driver: spike.driver })).rejects.toThrow(
      DriverLimitError,
    );
    expect(await spike.driver.applied()).toEqual([]);
  });

  it("plans only fail for ops the spike does not implement", async () => {
    const spike = createSqliteSpike();
    await migrateUp({ files: [init], driver: spike.driver });
    const drop = mig(idAt(2), init.id, [
      { op: "dropField", target: posts, name: "views" },
    ]);
    await expect(
      migrateUp({ files: [init, drop], driver: spike.driver, allowDestructive: "all" }),
    ).rejects.toThrow(SpikeUnsupportedError);
    expect((await spike.driver.applied()).map((a) => a.id)).toEqual([init.id]);
  });
});
