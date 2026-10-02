// Integration: reconciliation + runner + a driver, on real data. Plan section 15, scenarios 13-15.
// Uses only the fake driver (which uses the in-memory journal/lock); no real adapter.
import { describe, expect, it } from "vitest";
import {
  ChecksumMismatchError,
  LockLostError,
  MigrationLockedError,
  OutOfOrderConflictError,
} from "../errors/runner.js";
import { checksumOf } from "../migration/checksum.js";
import { idAt, mig } from "../migration/test-support.js";
import type { MigrationFile } from "../migration/types.js";
import { add, alter, col, create, dropField, int, text } from "../ops/test-support.js";
import { migrationStatus } from "../runner/status.js";
import { newStore, reconciled, run } from "../runner/test-support.js";
import { collectionAfter } from "../testing/builders.js";
import type { MigrationDriver } from "../driver/types.js";

const services = col("services");
const root = mig(idAt(1, "init"), null, [create(services, { title: text })]);

// A promise a test resolves by hand, to hold a migration mid-flight.
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

// `driver`, but `execute` of the first migration waits at `hold` and tells when it got there.
function holdFirstExecute(
  driver: MigrationDriver,
  hold: Promise<void>,
  arrived: () => void,
) {
  let first = true;
  const held: MigrationDriver = {
    ...driver,
    async execute(plan, lock) {
      if (first) {
        first = false;
        arrived();
        await hold;
      }
      return driver.execute(plan, lock);
    },
  };
  return held;
}

describe("13. out of order", () => {
  it("a database that ran B before A receives A once the branches are reconciled, and keeps its data", async () => {
    const store = newStore();
    // Production ran: root, B (the other developer's rename, merged first).
    const b = mig(idAt(3, "rename"), root.id, [
      { op: "renameField", target: services, from: "title", to: "name" },
    ]);
    await run([root, b], store.driver);
    await store.adapter.insert(collectionAfter([root, b], "services"), { name: "kept" });
    const checksumOfB = (await store.driver.applied())[1].checksum;

    // Then my older branch A (adds a field) is merged: reconcile puts B after A.
    const a = mig(idAt(2, "price"), root.id, [add(services, "price", int)]);
    const chain = reconciled([root, a, b]);
    expect(chain.map((f) => f.id)).toEqual([root.id, a.id, b.id]);
    expect(await checksumOf(chain[2])).toBe(checksumOfB);

    const status = await migrationStatus({ files: chain, driver: store.driver });
    expect(status).toMatchObject({
      pending: [a.id],
      outOfOrder: [a.id],
      outOfOrderConflict: false,
      checksumMismatch: [],
    });

    expect((await run(chain, store.driver)).applied).toEqual([a.id]);
    // The journal keeps the real order; the chain's order is the files'.
    expect((await store.driver.applied()).map((e) => e.id)).toEqual([
      root.id,
      b.id,
      a.id,
    ]);
    expect(store.dump().collections.services).toMatchObject([{ name: "kept" }]);
    expect(await migrationStatus({ files: chain, driver: store.driver })).toMatchObject({
      pending: [],
      outOfOrder: [],
    });
  });

  it("the pending migration is planned over the schema the database really has", async () => {
    const store = newStore();
    const b = mig(idAt(3, "stock"), root.id, [add(services, "stock", int)]);
    await run([root, b], store.driver);
    const a = mig(idAt(2, "price"), root.id, [add(services, "price", int)]);
    const seen: string[][] = [];
    const spy: MigrationDriver = {
      ...store.driver,
      plan: async (m) => {
        seen.push(Object.keys(m.before.snapshot.collections.services.fields));
        return store.driver.plan(m);
      },
    };
    await run(reconciled([root, a, b]), spy);
    expect(seen).toEqual([["title", "stock"]]);
  });

  it("a database that ran B where A cannot go before it is refused with the clash named", async () => {
    // A drops `a` and adds it back as text; B (already in production) turned `a` into a number.
    const base = mig(idAt(1, "init"), null, [create(services, { a: text })]);
    const b = mig(idAt(3, "to_int"), base.id, [alter(services, "a", text, int)]);
    const store = newStore();
    await run([base, b], store.driver, { allowDestructive: "all" });

    const a = mig(idAt(2, "recreate"), base.id, [
      dropField(services, "a"),
      add(services, "a", text),
    ]);
    const chain: MigrationFile[] = [base, a, { ...b, parent: a.id }];
    const error = await run(chain, store.driver).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OutOfOrderConflictError);
    expect((error as OutOfOrderConflictError).ids).toEqual([a.id]);
    expect(
      (error as OutOfOrderConflictError).result.conflicts.map((c) => c.resource),
    ).toContain("f:collection:services.a");
    expect((await store.driver.applied()).map((e) => e.id)).toEqual([base.id, b.id]);
  });
});

describe("14. editing an applied migration", () => {
  it("is refused with ChecksumMismatchError until the stored checksum is repaired", async () => {
    const store = newStore();
    const m2 = mig(idAt(2, "views"), root.id, [add(services, "views", int)]);
    await run([root, m2], store.driver);

    const edited = { ...m2, ops: [add(services, "views", text)] };
    const later = mig(idAt(3, "more"), m2.id, [add(services, "more", int)]);
    const error = await run([root, edited, later], store.driver).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChecksumMismatchError);
    expect((error as ChecksumMismatchError).ids).toEqual([m2.id]);
    expect((await store.driver.applied()).map((e) => e.id)).toEqual([root.id, m2.id]);

    // `repair-checksum`: the journal learns the file's current checksum; nothing re-runs.
    await store.driver.journal.setChecksum(m2.id, await checksumOf(edited));
    const result = await run([root, edited, later], store.driver);
    expect(result.applied).toEqual([later.id]);
  });
});

const fixedNow = () => new Date(Date.UTC(2026, 0, 1));

describe("15. concurrent migrateUp", () => {
  const files = [root, mig(idAt(2, "price"), root.id, [add(services, "price", int)])];

  it("the second process is refused while the first one holds the lock", async () => {
    const store = newStore();
    const hold = gate();
    const arrived = gate();
    const slow = holdFirstExecute(store.driver, hold.opened, arrived.open);

    const first = run(files, slow, { now: fixedNow, holder: "first" });
    await arrived.opened;
    const error = await run(files, store.driver, {
      now: fixedNow,
      holder: "second",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationLockedError);
    expect(error).toMatchObject({ holder: "first" });

    hold.open();
    expect((await first).applied).toEqual(files.map((f) => f.id));
    expect(await store.driver.lockInfo()).toBeUndefined();
  });

  it("with waitForLockMs the second waits for the first and then finds nothing pending", async () => {
    const store = newStore();
    const hold = gate();
    const arrived = gate();
    const slow = holdFirstExecute(store.driver, hold.opened, arrived.open);

    const first = run(files, slow, { now: fixedNow, holder: "first" });
    await arrived.opened;
    let polls = 0;
    const second = run(files, store.driver, {
      now: fixedNow,
      holder: "second",
      waitForLockMs: 10_000,
      sleep: async () => {
        polls++;
        hold.open();
        await first;
      },
    });
    expect((await second).applied).toEqual([]);
    expect((await first).applied).toEqual(files.map((f) => f.id));
    expect(polls).toBe(1);
    expect((await store.driver.applied()).map((e) => e.id)).toEqual(
      files.map((f) => f.id),
    );
  });

  it("a process whose lock expired and was taken gets LockLostError, and nothing runs twice", async () => {
    const store = newStore();
    let clock = Date.UTC(2026, 0, 1);
    const now = () => new Date(clock);
    const hold = gate();
    const arrived = gate();
    const slow = holdFirstExecute(store.driver, hold.opened, arrived.open);

    const first = run(files, slow, { now, holder: "first", lockTtlMs: 1000 });
    await arrived.opened;
    clock += 5000; // the first process stalled past its TTL
    const second = await run(files, store.driver, {
      now,
      holder: "second",
      lockTtlMs: 1000,
    });
    expect(second.applied).toEqual(files.map((f) => f.id));

    hold.open();
    await expect(first).rejects.toThrow(LockLostError);
    expect((await store.driver.applied()).map((e) => e.id)).toEqual(
      files.map((f) => f.id),
    );
    expect(store.dump().collections.services).toEqual([]);
  });
});
