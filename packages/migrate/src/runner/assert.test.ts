import { describe, expect, it } from "vitest";
import {
  ChecksumMismatchError,
  OutOfOrderConflictError,
  PendingMigrationsError,
  SchemaDriftError,
  UnknownAppliedMigrationError,
} from "../errors/runner.js";
import { MultipleHeadsError } from "../errors.js";
import { idAt, mig } from "../migration/test-support.js";
import { add, alter, col, create, dropField, int, text } from "../ops/test-support.js";
import { assertMigrated } from "./assert.js";
import { markAll, newStore, run, schemaOf } from "./test-support.js";

const posts = col("posts");
const m1 = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
const m2 = mig(idAt(2, "views"), m1.id, [add(posts, "views", int)]);
const chain = [m1, m2];

const check = (files = chain, store = newStore()) =>
  assertMigrated({ files, driver: store.driver, schema: schemaOf(files) });

describe("assertMigrated", () => {
  it("resolves for a database that has exactly the migrations, and changes nothing", async () => {
    const store = newStore();
    await run(chain, store.driver);
    const before = await store.driver.applied();
    await expect(check(chain, store)).resolves.toBeUndefined();
    expect(await store.driver.applied()).toEqual(before);
    expect(await store.driver.lockInfo()).toBeUndefined();
  });

  it("fails closed with the pending ids when the database is behind", async () => {
    const store = newStore();
    await run([m1], store.driver);
    const error = await check(chain, store).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PendingMigrationsError);
    expect(error).toMatchObject({ pending: [m2.id], running: [] });
    expect((await store.driver.applied()).map((a) => a.id)).toEqual([m1.id]);
  });

  it("treats an interrupted migration as not migrated", async () => {
    const store = newStore({ atomicity: "none" });
    await run([m1], store.driver);
    store.injectFailure(0);
    await expect(run(chain, store.driver)).rejects.toThrow();
    await expect(check(chain, store)).rejects.toMatchObject({ running: [m2.id] });
  });

  it("does not need the database lock: it works while a migration holds it", async () => {
    const store = newStore();
    await run(chain, store.driver);
    await store.driver.acquireLock("deploy", 60_000);
    await expect(check(chain, store)).resolves.toBeUndefined();
  });

  it("fails when the schema in code differs from the migrations", async () => {
    const store = newStore();
    await run(chain, store.driver);
    const code = schemaOf([...chain, mig(idAt(3), m2.id, [dropField(posts, "views")])]);
    const error = await assertMigrated({
      files: chain,
      driver: store.driver,
      schema: code,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaDriftError);
    expect((error as SchemaDriftError).ops).toEqual([dropField(posts, "views")]);
  });

  it("fails for migrations the files lack, edited migrations and an unsafe order", async () => {
    const unknown = newStore();
    await markAll(unknown.driver, chain);
    await unknown.driver.journal.markApplied({
      id: "20250101T000000000Z_ffff_x",
      checksum: "c",
    });
    await expect(check(chain, unknown)).rejects.toThrow(UnknownAppliedMigrationError);

    const edited = newStore();
    await run(chain, edited.driver);
    const changed = [m1, { ...m2, ops: [add(posts, "views", text)] }];
    await expect(
      assertMigrated({
        files: changed,
        driver: edited.driver,
        schema: schemaOf(changed),
      }),
    ).rejects.toThrow(ChecksumMismatchError);

    const base = mig(idAt(1, "init"), null, [create(posts, { a: text })]);
    const recreate = mig(idAt(2, "recreate"), base.id, [
      dropField(posts, "a"),
      add(posts, "a", text),
    ]);
    const toInt = mig(idAt(3, "to_int"), recreate.id, [alter(posts, "a", text, int)]);
    const unsafe = newStore();
    await markAll(unsafe.driver, [base, toInt]);
    await expect(check([base, recreate, toInt], unsafe)).rejects.toThrow(
      OutOfOrderConflictError,
    );
  });

  it("refuses unreconciled branches", async () => {
    await expect(check([...chain, mig(idAt(9, "fork"), m1.id)])).rejects.toThrow(
      MultipleHeadsError,
    );
  });
});
