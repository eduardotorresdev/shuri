import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockLostError } from "../errors/runner.js";
import type { ContractHarness, ContractWorld } from "./types.js";

/**
 * The contract for the migration lock: exclusive, expiring, extended by heartbeats, fenced.
 * @param name - Driver name, for the suite title.
 * @param h - The harness that builds a fresh driver.
 */
export function defineLockContract(name: string, h: ContractHarness): void {
  describe(`${name}: lock`, () => {
    let world: ContractWorld;
    let clock: number;
    const now = () => new Date(clock);
    beforeEach(async () => {
      world = await h.make();
      clock = Date.UTC(2026, 0, 1);
    });
    afterEach(async () => {
      await world.cleanup();
    });
    const driver = () => world.adapter.migrations;

    it("is exclusive: a second holder is refused until the first releases", async () => {
      const first = await driver().acquireLock("a", 1000, now);
      expect(first?.holder).toBe("a");
      expect(await driver().acquireLock("b", 1000, now)).toBeUndefined();
      await first?.release();
      expect((await driver().acquireLock("b", 1000, now))?.holder).toBe("b");
    });

    it("lockInfo reports the holder and when the lock expires; forceUnlock frees it", async () => {
      expect(await driver().lockInfo()).toBeUndefined();
      await driver().acquireLock("a", 1000, now);
      expect(await driver().lockInfo()).toEqual({
        holder: "a",
        expiresAt: new Date(clock + 1000).toISOString(),
      });
      expect(await driver().forceUnlock()).toMatchObject({ holder: "a" });
      expect(await driver().lockInfo()).toBeUndefined();
      expect(await driver().forceUnlock()).toBeUndefined();
      expect(await driver().acquireLock("b", 1000, now)).toBeDefined();
    });

    it("an expired lock is taken over, and the old holder is fenced out", async () => {
      const first = await driver().acquireLock("a", 1000, now);
      clock += 1001;
      const second = await driver().acquireLock("b", 1000, now);
      expect(second?.holder).toBe("b");
      await expect(first?.assertHeld()).rejects.toThrow(LockLostError);
      await expect(first?.heartbeat()).rejects.toThrow(LockLostError);
      // The old holder releasing late must not free the new holder's lock.
      await first?.release();
      expect(await driver().acquireLock("c", 1000, now)).toBeUndefined();
      await expect(second?.assertHeld()).resolves.toBeUndefined();
    });

    it("a heartbeat extends the lock", async () => {
      const lock = await driver().acquireLock("a", 1000, now);
      clock += 900;
      await lock?.heartbeat();
      clock += 900;
      expect(await driver().acquireLock("b", 1000, now)).toBeUndefined();
      await expect(lock?.assertHeld()).resolves.toBeUndefined();
      clock += 200;
      expect(await driver().acquireLock("b", 1000, now)).toBeDefined();
    });

    it("an expired lock nobody took is still held by its owner", async () => {
      const lock = await driver().acquireLock("a", 1000, now);
      clock += 5000;
      await expect(lock?.assertHeld()).resolves.toBeUndefined();
    });
  });
}
