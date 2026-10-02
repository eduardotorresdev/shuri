import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checksumOf } from "../migration/checksum.js";
import { chainOf, collection, createEntity, textSpec } from "./builders.js";
import { up } from "./contract-support.js";
import type { ContractHarness, ContractWorld } from "./types.js";

const posts = collection("posts");

/**
 * The contract for the journal: order of start, checksums, and the manual corrections.
 * @param name - Driver name, for the suite title.
 * @param h - The harness that builds a fresh driver.
 */
export function defineJournalContract(name: string, h: ContractHarness): void {
  describe(`${name}: journal`, () => {
    let world: ContractWorld;
    beforeEach(async () => {
      world = await h.make();
    });
    afterEach(async () => {
      await world.cleanup();
    });
    const files = chainOf(
      [createEntity(posts, { title: textSpec })],
      [{ op: "addField", target: posts, name: "body", spec: textSpec }],
    );
    const driver = () => world.adapter.migrations;

    it("declares capabilities that agree with each other", () => {
      const { atomicity, transactionalJournal } = driver().capabilities;
      if (atomicity === "migration") expect(transactionalJournal).toBe(true);
    });

    it("records each migration as done, in order, with the checksum of its file", async () => {
      await up(world, files);
      const applied = await driver().applied();
      expect(applied.map((a) => a.id)).toEqual(files.map((f) => f.id));
      expect(applied.every((a) => a.status === "done" && a.finishedAt)).toBe(true);
      expect(applied.map((a) => a.checksum)).toEqual(
        await Promise.all(files.map((f) => checksumOf(f))),
      );
    });

    it("markApplied records a migration without running it, so `up` skips it", async () => {
      await driver().journal.markApplied({
        id: files[0].id,
        checksum: await checksumOf(files[0]),
      });
      expect((await up(world, files)).applied).toEqual([files[1].id]);
    });

    it("unmark makes a migration pending again", async () => {
      await up(world, files);
      await driver().journal.unmark(files[1].id);
      expect((await driver().applied()).map((a) => a.id)).toEqual([files[0].id]);
      expect((await up(world, files)).applied).toEqual([files[1].id]);
    });

    it("setChecksum rewrites the stored checksum of one entry only", async () => {
      await up(world, files);
      const before = await driver().applied();
      await driver().journal.setChecksum(files[1].id, "sha256:new");
      const after = await driver().applied();
      expect(after[1].checksum).toBe("sha256:new");
      expect(after[0]).toEqual(before[0]);
    });
  });
}
