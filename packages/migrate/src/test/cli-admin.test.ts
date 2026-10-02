// Integration: recovery commands (`baseline`, `unlock`, `mark-applied`, `unmark`, `repair-checksum`,
// `render`) through runCli, on the fake store.
import { afterEach, describe, expect, it } from "vitest";
import { checksumOf } from "../migration/checksum.js";
import { idAt } from "../migration/test-support.js";
import { col, create, int, text } from "../ops/test-support.js";
import { chain, m1, m2, m3 } from "../runner/test-support.js";
import { makeHarness, type Harness } from "./cli-support.js";

const posts = col("posts");
let h: Harness;
afterEach(() => h.cleanup());

async function ready(options?: Parameters<typeof makeHarness>[0]) {
  h = await makeHarness(options);
  await h.put(...chain);
  h.setSchema(create(posts, { title: text, body: text, views: int, tags: text }));
}
const driver = () => h.store.adapter.migrations;
const journal = async () => (await driver().applied()).map((e) => e.id);

describe("baseline", () => {
  it("records the whole chain as applied, with the file checksums, without running anything", async () => {
    await ready();

    const r = await h.run(["baseline"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`baselined 3 migration(s) up to ${m3.id}`);
    const entries = await driver().applied();
    expect(entries.map((e) => [e.id, e.status, e.checksum])).toEqual(
      await Promise.all(chain.map(async (f) => [f.id, "done", await checksumOf(f)])),
    );
    expect(h.store.dump().collections).toEqual({});
    expect((await h.run(["status", "--exit-code"])).code).toBe(0);
  });

  it("--to stops at that migration and leaves the rest pending", async () => {
    await ready();

    await h.run(["baseline", "--to", m2.id]);

    expect(await journal()).toEqual([m1.id, m2.id]);
    expect((await h.run(["status", "--json"])).json?.result).toMatchObject({
      pending: [m3.id],
    });
  });

  it("refuses a journal that is not empty, and an unknown --to, and an empty chain", async () => {
    await ready();
    await driver().journal.markApplied({ id: m1.id, checksum: await checksumOf(m1) });
    const used = await h.run(["baseline"]);
    expect(used.code).toBe(1);
    expect(used.stderr).toContain("the journal is not empty");
    expect(await journal()).toEqual([m1.id]);

    const unknown = await h.run(["baseline", "--to", idAt(9)]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("is not a migration of the chain");

    await h.cleanup();
    h = await makeHarness();
    const empty = await h.run(["baseline"]);
    expect(empty.code).toBe(1);
    expect(empty.stderr).toContain("next: run `shuri-migrate generate init` first");
  });

  it("is blocked by a lock held elsewhere (exit 5)", async () => {
    await ready();
    await driver().acquireLock("deploy", 60_000);

    expect((await h.run(["baseline"])).code).toBe(5);
    expect(await journal()).toEqual([]);
  });
});

describe("unlock", () => {
  it("says so when nothing is locked", async () => {
    await ready();
    const r = await h.run(["unlock"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("no lock is held\n");
  });

  it("shows the holder and exits 5 without --force; --force releases it", async () => {
    await ready();
    await driver().acquireLock("crashed-deploy", 60_000);

    const shown = await h.run(["unlock"]);
    expect(shown.code).toBe(5);
    expect(shown.stdout).toContain("held by crashed-deploy");
    expect(await driver().lockInfo()).toBeDefined();

    const forced = await h.run(["unlock", "--force"]);
    expect(forced.code).toBe(0);
    expect(forced.stdout).toContain("released the lock (was held by crashed-deploy");
    expect(await driver().lockInfo()).toBeUndefined();
    expect((await h.run(["up"])).code).toBe(0);
  });
});

describe("mark-applied / unmark / repair-checksum", () => {
  it("refuse to run without a way to confirm, and change nothing", async () => {
    await ready();
    const r = await h.run(["mark-applied", m1.id]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      `next: re-run \`shuri-migrate mark-applied ${m1.id} --yes\` to confirm`,
    );
    expect(await journal()).toEqual([]);
  });

  it("mark-applied records the file's checksum; `up` then skips that migration", async () => {
    await ready();

    const r = await h.run(["mark-applied", m1.id, "--yes"]);

    expect(r.code).toBe(0);
    expect((await driver().applied())[0]).toMatchObject({
      id: m1.id,
      checksum: await checksumOf(m1),
    });
    expect((await h.run(["status", "--json"])).json?.result).toMatchObject({
      pending: [m2.id, m3.id],
    });
  });

  it("asks on a terminal: no aborts, yes proceeds", async () => {
    await ready();

    const no = await h.run(["mark-applied", m1.id], { isTTY: true, answers: [false] });
    expect(no.code).toBe(1);
    expect(no.stderr).toContain("aborted: nothing was changed");
    expect(await journal()).toEqual([]);

    const yes = await h.run(["mark-applied", m1.id], { isTTY: true, answers: [true] });
    expect(yes.code).toBe(0);
    expect(h.questions[1]).toContain(`record ${m1.id} as applied WITHOUT running it?`);
    expect(await journal()).toEqual([m1.id]);
  });

  it("mark-applied rejects ids outside the chain and ids already recorded", async () => {
    await ready();
    expect((await h.run(["mark-applied", idAt(9), "--yes"])).code).toBe(1);
    await h.run(["mark-applied", m1.id, "--yes"]);
    const again = await h.run(["mark-applied", m1.id, "--yes"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("already in the journal");
  });

  it("unmark removes the entry so `up` runs it again; an id not in the journal is an error", async () => {
    await ready();
    await h.run(["up"]);

    const r = await h.run(["unmark", m3.id, "--yes"]);
    expect(r.code).toBe(0);
    expect(await journal()).toEqual([m1.id, m2.id]);

    expect((await h.run(["unmark", m3.id, "--yes"])).code).toBe(1);
  });

  it("repair-checksum is a no-op when the journal already matches the file, and errors for unknown or unapplied ids", async () => {
    await ready();
    await h.run(["up"]);

    const same = await h.run(["repair-checksum", m1.id, "--yes", "--json"]);
    expect(same.code).toBe(0);
    expect(same.json?.result).toMatchObject({ id: m1.id, changed: false });

    expect((await h.run(["repair-checksum", idAt(9), "--yes"])).code).toBe(1);
    await driver().journal.unmark(m3.id);
    const unapplied = await h.run(["repair-checksum", m3.id, "--yes"]);
    expect(unapplied.code).toBe(1);
    expect(unapplied.stderr).toContain("is not in the journal");
  });

  it("repair-checksum reports the old and new checksum", async () => {
    await ready();
    await h.run(["up"]);
    await driver().journal.setChecksum(m1.id, "sha256:stale");

    const r = await h.run(["repair-checksum", m1.id, "--yes"]);

    expect(r.stdout).toContain("was sha256:stale");
    expect(r.stdout).toContain(`now ${await checksumOf(m1)}`);
  });
});

describe("render", () => {
  it("exits 1 for a driver that cannot render", async () => {
    await ready();
    const r = await h.run(["render", m1.id]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cannot render");
  });

  it("prints the driver's text for one migration, planned over the database's real order", async () => {
    await ready({
      driver: (d) => ({
        ...d,
        capabilities: { ...d.capabilities, render: true },
        render: (plan) =>
          `-- ${plan.migration.id}\n${plan.steps.map((s) => s.description).join("\n")}\n`,
      }),
    });
    await h.run(["baseline", "--to", m1.id]);

    const r = await h.run(["render", m2.id]);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      `-- ${m2.id}\naddField views number(integer) in collection posts\n`,
    );
    expect((await h.run(["render", idAt(9)])).code).toBe(1);
  });
});
