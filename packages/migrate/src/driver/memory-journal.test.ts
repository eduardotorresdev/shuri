import { describe, expect, it } from "vitest";
import { LockLostError } from "../errors/runner.js";
import { createMemoryJournal } from "./memory-journal.js";

function clockAt(start: string) {
  let ms = Date.parse(start);
  return {
    now: () => new Date(ms),
    advance: (by: number) => {
      ms += by;
    },
  };
}

describe("memory journal", () => {
  it("begin writes a running entry that finish turns into done, keeping the start time", async () => {
    const clock = clockAt("2026-01-01T00:00:00.000Z");
    const j = createMemoryJournal(clock.now);
    j.begin({ id: "m1", checksum: "sha256:a" });
    expect(await j.applied()).toEqual([
      {
        id: "m1",
        checksum: "sha256:a",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    clock.advance(5000);
    j.finish("m1");
    expect(await j.applied()).toEqual([
      {
        id: "m1",
        checksum: "sha256:a",
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:05.000Z",
      },
    ]);
  });

  it("beginning an entry that already exists changes nothing (a re-run of a running migration)", async () => {
    const clock = clockAt("2026-01-01T00:00:00.000Z");
    const j = createMemoryJournal(clock.now);
    j.begin({ id: "m1", checksum: "sha256:a" });
    clock.advance(1000);
    j.begin({ id: "m1", checksum: "sha256:a" });
    const entries = await j.applied();
    expect(entries).toHaveLength(1);
    expect(entries[0].startedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("applied lists entries in order of start and returns copies", async () => {
    const j = createMemoryJournal();
    await j.journal.markApplied({ id: "b", checksum: "x" });
    await j.journal.markApplied({ id: "a", checksum: "y" });
    const first = await j.applied();
    expect(first.map((e) => e.id)).toEqual(["b", "a"]);
    first[0].checksum = "tampered";
    expect((await j.applied())[0].checksum).toBe("x");
  });

  it("markApplied on a running entry completes it with the new checksum", async () => {
    const j = createMemoryJournal();
    j.begin({ id: "m1", checksum: "old" });
    await j.journal.markApplied({ id: "m1", checksum: "new" });
    const [entry] = await j.applied();
    expect(entry).toMatchObject({ checksum: "new", status: "done" });
    expect(entry.finishedAt).toBeDefined();
  });

  it("unmark removes an entry and ignores an unknown id", async () => {
    const j = createMemoryJournal();
    await j.journal.markApplied({ id: "m1", checksum: "x" });
    await j.journal.unmark("nope");
    await j.journal.unmark("m1");
    expect(await j.applied()).toEqual([]);
  });

  it("setChecksum fails for an id that is not in the journal", async () => {
    const j = createMemoryJournal();
    await expect(j.journal.setChecksum("nope", "x")).rejects.toThrow(
      /not in the journal/,
    );
  });

  describe("lock", () => {
    it("a lock expires exactly after its TTL and not before", async () => {
      const clock = clockAt("2026-01-01T00:00:00.000Z");
      const j = createMemoryJournal();
      await j.acquireLock("a", 1000, clock.now);
      clock.advance(1000);
      expect(await j.acquireLock("b", 1000, clock.now)).toBeUndefined();
      clock.advance(1);
      expect((await j.acquireLock("b", 1000, clock.now))?.holder).toBe("b");
    });

    it("heartbeat uses the clock given at acquisition", async () => {
      const clock = clockAt("2026-01-01T00:00:00.000Z");
      const j = createMemoryJournal();
      const lock = await j.acquireLock("a", 1000, clock.now);
      clock.advance(800);
      await lock?.heartbeat();
      expect(await j.lockInfo()).toEqual({
        holder: "a",
        expiresAt: "2026-01-01T00:00:01.800Z",
      });
    });

    it("a released lock cannot be asserted or heartbeaten any more", async () => {
      const j = createMemoryJournal();
      const lock = await j.acquireLock("a", 1000);
      await lock?.release();
      await expect(lock?.assertHeld()).rejects.toThrow(LockLostError);
      await expect(lock?.heartbeat()).rejects.toThrow(LockLostError);
    });
  });
});
