import { describe, expect, it } from "vitest";
import { GraphError, MultipleHeadsError } from "../errors.js";
import { checksumOf } from "../migration/checksum.js";
import { idAt, mig } from "../migration/test-support.js";
import {
  add,
  alter,
  col,
  create,
  dropField,
  int,
  text,
  textarea,
} from "../ops/test-support.js";
import { schemaFromSnapshot } from "../testing/schema-from-snapshot.js";
import { replay } from "../ops/replay.js";
import { migrationStatus } from "./status.js";
import { markAll, newStore, run, schemaOf } from "./test-support.js";

const posts = col("posts");
const m1 = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
const m2 = mig(idAt(2, "views"), m1.id, [add(posts, "views", int)]);
const m3 = mig(idAt(3, "tags"), m2.id, [add(posts, "tags", text)]);
const chain = [m1, m2, m3];

describe("migrationStatus", () => {
  it("on an empty database everything is pending, in chain order", async () => {
    const { driver } = newStore();
    expect(await migrationStatus({ files: [m3, m1, m2], driver })).toEqual({
      chain: [m1.id, m2.id, m3.id],
      applied: [],
      pending: [m1.id, m2.id, m3.id],
      running: [],
      unknownApplied: [],
      checksumMismatch: [],
      outOfOrder: [],
      outOfOrderConflict: false,
      schemaDrift: null,
    });
  });

  it("after `up` nothing is pending and the journal is reported", async () => {
    const { driver } = newStore();
    await run(chain, driver);
    const status = await migrationStatus({
      files: chain,
      driver,
      schema: schemaOf(chain),
    });
    expect(status.pending).toEqual([]);
    expect(status.applied.map((a) => a.id)).toEqual([m1.id, m2.id, m3.id]);
    expect(status.schemaDrift).toBeNull();
  });

  it("lists what is still pending after a partial run", async () => {
    const { driver } = newStore();
    await run([m1, m2], driver);
    expect((await migrationStatus({ files: chain, driver })).pending).toEqual([m3.id]);
  });

  it("reports migrations the files do not have", async () => {
    const { driver } = newStore();
    await driver.journal.markApplied({
      id: "20250101T000000000Z_ffff_ghost",
      checksum: "x",
    });
    const status = await migrationStatus({ files: chain, driver });
    expect(status.unknownApplied).toEqual(["20250101T000000000Z_ffff_ghost"]);
    expect(status.pending).toEqual([m1.id, m2.id, m3.id]);
  });

  it("reports a migration edited after it ran", async () => {
    const { driver } = newStore();
    await run(chain, driver);
    const edited = { ...m2, ops: [add(posts, "views", text)] };
    const status = await migrationStatus({ files: [m1, edited, m3], driver });
    expect(status.checksumMismatch).toEqual([m2.id]);
  });

  it("a rebased migration (new parent) does not look edited", async () => {
    const { driver } = newStore();
    await markAll(driver, [m1, m2]);
    const rebased = { ...m2, parent: m1.id };
    const status = await migrationStatus({ files: [m1, rebased], driver });
    expect(status.checksumMismatch).toEqual([]);
    expect(await checksumOf(rebased)).toBe(await checksumOf(m2));
  });

  it("reports an interrupted migration as running", async () => {
    const { driver, injectFailure } = newStore({ atomicity: "none" });
    await run([m1], driver);
    injectFailure(0);
    await expect(run(chain, driver)).rejects.toThrow();
    const status = await migrationStatus({ files: chain, driver });
    expect(status.running).toEqual([m2.id]);
    expect(status.pending).toEqual([m3.id]);
  });

  it("flags a pending migration that sits before an applied one in the chain", async () => {
    const { driver } = newStore();
    await markAll(driver, [m1, m3]);
    const status = await migrationStatus({ files: chain, driver });
    expect(status.pending).toEqual([m2.id]);
    expect(status.outOfOrder).toEqual([m2.id]);
    expect(status.outOfOrderConflict).toBe(false);
  });

  it("a pending migration after every applied one is not out of order", async () => {
    const { driver } = newStore();
    await markAll(driver, [m1]);
    expect((await migrationStatus({ files: chain, driver })).outOfOrder).toEqual([]);
  });

  describe("out-of-order conflicts", () => {
    const base = mig(idAt(1, "init"), null, [create(posts, { title: text, a: text })]);

    it("flags a pending migration whose order changes the resulting schema", async () => {
      // Chain: base, A (drops `a` and adds it back), B (turns `a` into a number). The database ran
      // B on its own: running A after it recreates `a` as text, the chain ends with `a` a number.
      const recreate = mig(idAt(2, "recreate"), base.id, [
        dropField(posts, "a"),
        add(posts, "a", text),
      ]);
      const toInt = mig(idAt(3, "to_int"), recreate.id, [alter(posts, "a", text, int)]);
      const { driver } = newStore();
      await markAll(driver, [base, toInt]);
      const status = await migrationStatus({ files: [base, recreate, toInt], driver });
      expect(status.outOfOrder).toEqual([recreate.id]);
      expect(status.outOfOrderConflict).toBe(true);
    });

    it("flags a pending migration whose later neighbour cannot run without it", async () => {
      const rename = mig(idAt(2, "rename"), base.id, [
        { op: "renameField", target: posts, from: "a", to: "b" },
      ]);
      const alterB = mig(idAt(3, "alter_b"), rename.id, [
        alter(posts, "b", text, textarea),
      ]);
      const { driver } = newStore();
      await markAll(driver, [base, alterB]);
      const status = await migrationStatus({ files: [base, rename, alterB], driver });
      expect(status.outOfOrderConflict).toBe(true);
    });

    it("independent migrations in the other order are fine", async () => {
      const x = mig(idAt(2, "x"), base.id, [add(posts, "x", int)]);
      const y = mig(idAt(3, "y"), x.id, [add(posts, "y", int)]);
      const { driver } = newStore();
      await markAll(driver, [base, y]);
      expect(
        (await migrationStatus({ files: [base, x, y], driver })).outOfOrderConflict,
      ).toBe(false);
    });
  });

  describe("schema drift", () => {
    it("lists the ops that take the migrations to the schema in code", async () => {
      const { driver } = newStore();
      const code = replay([
        ...chain,
        mig(idAt(4), m3.id, [dropField(posts, "tags")]),
      ]).snapshot;
      const status = await migrationStatus({
        files: chain,
        driver,
        schema: schemaFromSnapshot(code),
      });
      expect(status.schemaDrift).toEqual([dropField(posts, "tags")]);
    });

    it("is null when no schema is given", async () => {
      const { driver } = newStore();
      expect((await migrationStatus({ files: chain, driver })).schemaDrift).toBeNull();
    });
  });

  it("refuses unreconciled branches and invalid graphs instead of guessing", async () => {
    const { driver } = newStore();
    const fork = mig(idAt(9, "fork"), m1.id);
    await expect(migrationStatus({ files: [m1, m2, fork], driver })).rejects.toThrow(
      MultipleHeadsError,
    );
    await expect(migrationStatus({ files: [m2], driver })).rejects.toThrow(GraphError);
  });
});
