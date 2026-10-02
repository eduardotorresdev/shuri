import { describe, expect, it } from "vitest";
import type { MigrationDriver } from "../driver/types.js";
import {
  ChecksumMismatchError,
  DriverLimitError,
  OutOfOrderConflictError,
  SchemaDriftError,
  UnknownAppliedMigrationError,
} from "../errors/runner.js";
import { MultipleHeadsError } from "../errors.js";
import { idAt, mig } from "../migration/test-support.js";
import { add, alter, create, dropField, int, text } from "../ops/test-support.js";
import { collectionAfter } from "../testing/builders.js";
import {
  chain,
  ids,
  m1,
  m2,
  m3,
  markAll,
  newStore,
  posts,
  run,
  schemaOf,
} from "./test-support.js";

describe("migrateUp", () => {
  it("applies every pending migration in chain order and records them", async () => {
    const { driver, dump } = newStore();
    const result = await run([m3, m1, m2], driver);
    expect(result.applied).toEqual(ids(chain));
    expect((await driver.applied()).map((a) => [a.id, a.status])).toEqual(
      chain.map((f) => [f.id, "done"]),
    );
    expect(Object.keys(dump().collections)).toEqual(["posts"]);
  });

  it("only applies what is pending", async () => {
    const { driver } = newStore();
    await run([m1], driver);
    expect((await run(chain, driver)).applied).toEqual([m2.id, m3.id]);
    expect((await run(chain, driver)).applied).toEqual([]);
  });

  it("passes the driver the real before/after states and each op's effect", async () => {
    const { driver } = newStore();
    const seen: { id: string; effects: string[]; hasViews: boolean }[] = [];
    const spy: MigrationDriver = {
      ...driver,
      async plan(m) {
        seen.push({
          id: m.id,
          effects: m.ops.map((p) => p.effect),
          hasViews: "views" in (m.before.snapshot.collections.posts?.fields ?? {}),
        });
        return driver.plan(m);
      },
    };
    const again = mig(idAt(4, "again"), m3.id, [
      add(posts, "views", int),
      add(posts, "n", int),
    ]);
    await run([...chain, again], spy);
    expect(seen.at(-1)).toEqual({
      id: again.id,
      effects: ["noop", "applied"],
      hasViews: true,
    });
    expect(seen[0]).toMatchObject({ id: m1.id, hasViews: false });
  });

  it("refuses unreconciled branches", async () => {
    const { driver } = newStore();
    await expect(run([...chain, mig(idAt(9, "fork"), m1.id)], driver)).rejects.toThrow(
      MultipleHeadsError,
    );
    expect(await driver.applied()).toEqual([]);
  });

  describe("before taking the lock", () => {
    it("refuses when the schema in code differs from the migrations, touching nothing", async () => {
      const { driver } = newStore();
      const code = schemaOf([...chain, mig(idAt(4), m3.id, [dropField(posts, "tags")])]);
      const error = await run(chain, driver, { schema: code }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SchemaDriftError);
      expect((error as SchemaDriftError).ops).toEqual([dropField(posts, "tags")]);
      expect(await driver.applied()).toEqual([]);
      expect(await driver.lockInfo()).toBeUndefined();
    });

    it("accepts a schema that matches the migrations", async () => {
      const { driver } = newStore();
      await expect(
        run(chain, driver, { schema: schemaOf(chain) }),
      ).resolves.toMatchObject({
        applied: ids(chain),
      });
    });

    it("refuses a schema the engine cannot hold", async () => {
      const { driver } = newStore();
      const limited: MigrationDriver = {
        ...driver,
        validateSnapshot: (snapshot) =>
          Object.keys(snapshot.collections.posts?.fields ?? {}).length > 2
            ? [{ path: "collections.posts", message: "at most 2 fields" }]
            : [],
      };
      const error = await run(chain, limited).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DriverLimitError);
      expect((error as DriverLimitError).issues).toEqual([
        { path: "collections.posts", message: "at most 2 fields" },
      ]);
      expect(await driver.applied()).toEqual([]);
    });
  });

  describe("the journal is checked under the lock", () => {
    it("refuses a database that applied a migration the files do not have", async () => {
      const { driver } = newStore();
      await driver.journal.markApplied({
        id: "20250101T000000000Z_ffff_ghost",
        checksum: "x",
      });
      const error = await run(chain, driver).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnknownAppliedMigrationError);
      expect((error as UnknownAppliedMigrationError).ids).toEqual([
        "20250101T000000000Z_ffff_ghost",
      ]);
      expect(await driver.lockInfo()).toBeUndefined();
    });

    it("refuses a migration edited after it ran, before applying the pending ones", async () => {
      const { driver, dump } = newStore();
      await run([m1, m2], driver);
      const edited = { ...m2, ops: [add(posts, "views", text)] };
      const error = await run([m1, edited, m3], driver).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ChecksumMismatchError);
      expect((error as ChecksumMismatchError).ids).toEqual([m2.id]);
      expect((await driver.applied()).map((a) => a.id)).toEqual([m1.id, m2.id]);
      expect(dump().collections.posts).toEqual([]);
    });

    it("refuses an out-of-order pending migration that would change the result", async () => {
      const base = mig(idAt(1, "init"), null, [create(posts, { a: text })]);
      const recreate = mig(idAt(2, "recreate"), base.id, [
        dropField(posts, "a"),
        add(posts, "a", text),
      ]);
      const toInt = mig(idAt(3, "to_int"), recreate.id, [alter(posts, "a", text, int)]);
      const { driver } = newStore();
      await markAll(driver, [base, toInt]);
      const error = await run([base, recreate, toInt], driver).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OutOfOrderConflictError);
      expect((error as OutOfOrderConflictError).ids).toEqual([recreate.id]);
      expect((await driver.applied()).map((a) => a.id)).toEqual([base.id, toInt.id]);
    });
  });

  describe("dryRun", () => {
    it("returns the driver's plans, executes nothing and releases the lock", async () => {
      const { driver, dump } = newStore();
      const result = await run(chain, driver, { dryRun: true });
      expect(result.applied).toEqual([]);
      expect(result.plans.map((p) => p.migration.id)).toEqual(ids(chain));
      expect(result.plans[1].steps).toEqual([
        { description: expect.stringContaining("addField views"), destructive: false },
      ]);
      expect(await driver.applied()).toEqual([]);
      expect(dump().collections).toEqual({});
      expect(await driver.lockInfo()).toBeUndefined();
    });

    it("shows destructive steps instead of refusing them, so they can be reviewed", async () => {
      const { driver } = newStore();
      const drop = mig(idAt(4, "drop_body"), m3.id, [dropField(posts, "body")]);
      const { plans } = await run([...chain, drop], driver, { dryRun: true });
      expect(plans.at(-1)?.steps.map((s) => s.destructive)).toEqual([true]);
    });

    it("plans nothing when the database is up to date", async () => {
      const { driver } = newStore();
      await run(chain, driver);
      expect((await run(chain, driver, { dryRun: true })).plans).toEqual([]);
    });
  });

  it("re-runs an interrupted migration from its first op and finishes it", async () => {
    const store = newStore({ atomicity: "none" });
    const rename = mig(idAt(2, "rename"), m1.id, [
      { op: "renameField", target: posts, from: "title", to: "name" },
      add(posts, "views", int),
    ]);
    await run([m1], store.driver);
    await store.adapter.insert(collectionAfter([m1], "posts"), { title: "a" });
    store.injectFailure(1);
    await expect(run([m1, rename], store.driver)).rejects.toThrow();
    expect((await store.driver.applied()).map((a) => [a.id, a.status])).toEqual([
      [m1.id, "done"],
      [rename.id, "running"],
    ]);
    const planned: string[][] = [];
    const spy: MigrationDriver = {
      ...store.driver,
      plan: async (m) => {
        planned.push(m.ops.map((p) => p.effect));
        return store.driver.plan(m);
      },
    };
    expect((await run([m1, rename], spy)).applied).toEqual([rename.id]);
    // Every op is planned as applied again: the driver's ops are idempotent over partial data.
    expect(planned).toEqual([["applied", "applied"]]);
    expect(store.dump().collections.posts).toMatchObject([{ name: "a" }]);
    expect((await store.driver.applied()).map((a) => a.status)).toEqual(["done", "done"]);
  });
});
