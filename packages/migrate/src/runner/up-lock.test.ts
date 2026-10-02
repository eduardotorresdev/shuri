import { describe, expect, it } from "vitest";
import { LockLostError, MigrationLockedError } from "../errors/runner.js";
import { chain, ids, m1, newStore, run, wrapped } from "./test-support.js";

describe("migrateUp lock", () => {
  it("is refused with the holder and expiry while another process holds it", async () => {
    const { driver } = newStore();
    let clock = Date.UTC(2026, 0, 1);
    const now = () => new Date(clock);
    await driver.acquireLock("deploy-1", 60_000, now);
    const error = await run(chain, driver, { now }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationLockedError);
    expect(error).toMatchObject({
      holder: "deploy-1",
      expiresAt: new Date(clock + 60_000).toISOString(),
    });
    expect(await driver.applied()).toEqual([]);
    clock += 61_000;
    await expect(run(chain, driver, { now })).resolves.toMatchObject({
      applied: ids(chain),
    });
  });

  it("is released after success and after a failure", async () => {
    const { driver, injectFailure } = newStore();
    await run([m1], driver);
    expect(await driver.lockInfo()).toBeUndefined();
    injectFailure(0);
    await expect(run(chain, driver)).rejects.toThrow();
    expect(await driver.lockInfo()).toBeUndefined();
  });

  it("is held under the given holder name while migrations run", async () => {
    const { driver } = newStore();
    let during: unknown;
    const spy = wrapped(driver, {
      beforeExecute: async () => {
        during = await driver.lockInfo();
      },
    });
    await run([m1], spy, { holder: "ci-42", lockTtlMs: 5000 });
    expect(during).toMatchObject({ holder: "ci-42" });
  });

  it("defaults the holder to a random UUID", async () => {
    const { driver } = newStore();
    let holder = "";
    const spy = wrapped(driver, {
      beforeExecute: async (_id, lock) => {
        holder = lock.holder;
      },
    });
    await run([m1], spy);
    expect(holder).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("waits for a busy lock, polling, and then finds nothing left to do", async () => {
    const { driver } = newStore();
    const other = await driver.acquireLock("other", 60_000);
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      if (sleeps.length === 3) {
        // The other process finishes the work and lets go while we wait.
        await other?.release();
        await run(chain, driver, { holder: "other" });
      }
    };
    const result = await run(chain, driver, { waitForLockMs: 1000, sleep });
    expect(sleeps).toEqual([100, 100, 100]);
    expect(result.applied).toEqual([]);
    expect((await driver.applied()).map((a) => a.id)).toEqual(ids(chain));
  });

  it("gives up after waiting exactly `waitForLockMs`", async () => {
    const { driver } = newStore();
    await driver.acquireLock("other", 60_000);
    const sleeps: number[] = [];
    const error = await run(chain, driver, {
      waitForLockMs: 250,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationLockedError);
    expect(sleeps).toEqual([100, 100, 50]);
  });

  it("fails fast by default", async () => {
    const { driver } = newStore();
    await driver.acquireLock("other", 60_000);
    const sleeps: number[] = [];
    await expect(
      run(chain, driver, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).rejects.toThrow(MigrationLockedError);
    expect(sleeps).toEqual([]);
  });

  it("a holder whose lock expired and was taken gets LockLostError and changes nothing", async () => {
    const { driver } = newStore();
    let clock = Date.UTC(2026, 0, 1);
    const now = () => new Date(clock);
    const spy = wrapped(driver, {
      beforeExecute: async () => {
        clock += 61_000;
        await driver.acquireLock("thief", 60_000, now);
      },
    });
    await expect(run(chain, spy, { now, holder: "slow" })).rejects.toThrow(LockLostError);
    expect(await driver.applied()).toEqual([]);
    // The thief still owns the lock: the loser's release did not free it.
    expect(await driver.lockInfo()).toMatchObject({ holder: "thief" });
  });

  it("keeps the lock alive with heartbeats while a slow migration runs", async () => {
    const { driver } = newStore();
    let beats = 0;
    const heartbeats = () => beats;
    const spy = wrapped(driver, {
      lockOf: (lock) => ({
        ...lock,
        heartbeat: async () => {
          beats++;
          await lock.heartbeat();
        },
      }),
      // "Slow" means: runs until three heartbeats were seen (bounded), however loaded the machine is.
      beforeExecute: async () => {
        const deadline = Date.now() + 10_000;
        while (heartbeats() < 3 && Date.now() < deadline) {
          await new Promise((done) => setTimeout(done, 5));
        }
      },
    });
    await run([m1], spy, { lockTtlMs: 30 });
    expect(beats).toBeGreaterThanOrEqual(3);
  });

  it("stops before the next migration when a heartbeat failed", async () => {
    const { driver } = newStore();
    const spy = wrapped(driver, {
      lockOf: (lock) => ({
        ...lock,
        heartbeat: async () => {
          throw new Error("heartbeat boom");
        },
      }),
      beforeExecute: () => new Promise((done) => setTimeout(done, 60)),
    });
    await expect(run(chain, spy, { lockTtlMs: 30 })).rejects.toThrow("heartbeat boom");
    expect((await driver.applied()).map((a) => a.id)).toEqual([m1.id]);
  });
});
