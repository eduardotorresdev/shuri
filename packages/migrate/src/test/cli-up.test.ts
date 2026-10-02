// Integration: `status`, `up` and the lock/checksum/destructive exit codes through runCli, on the fake store.
import { afterEach, describe, expect, it } from "vitest";
import { checksumOf } from "../migration/checksum.js";
import { idAt, mig } from "../migration/test-support.js";
import { add, col, create, dropField, int, text } from "../ops/test-support.js";
import { chain, m1, m2, m3 } from "../runner/test-support.js";
import { collectionAfter } from "../testing/builders.js";
import { makeHarness, type Harness } from "./cli-support.js";

const posts = col("posts");
const fullSchema = () =>
  create(posts, { title: text, body: text, views: int, tags: text });

let h: Harness;
afterEach(() => h.cleanup());

async function ready() {
  h = await makeHarness();
  await h.put(...chain);
  h.setSchema(fullSchema());
}
const driver = () => h.store.adapter.migrations;

describe("status", () => {
  it("reports the pending migrations and only fails for them with --exit-code", async () => {
    await ready();

    const plain = await h.run(["status"]);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain("3 migration(s) in the chain; 0 applied, 3 pending");
    expect(plain.stdout).toContain(m2.id);

    expect((await h.run(["status", "--exit-code"])).code).toBe(4);
  });

  it("is clean (exit 0 even with --exit-code) once everything ran", async () => {
    await ready();
    await h.run(["up"]);

    const r = await h.run(["status", "--exit-code", "--json"]);

    expect(r.code).toBe(0);
    expect(r.json?.ok).toBe(true);
    expect(r.json?.result).toMatchObject({ pending: [], running: [], schemaDrift: null });
  });

  it("flags drift between the schema in code and the migrations", async () => {
    await ready();
    await h.run(["up"]);
    h.setSchema(
      create(posts, { title: text, body: text, views: int, tags: text, extra: text }),
    );

    const r = await h.run(["status", "--exit-code"]);

    expect(r.code).toBe(4);
    expect(r.stdout).toContain("schema in code differs from the migrations:");
    expect(r.stdout).toContain("addField extra");
  });

  it("exits 7 with --exit-code when a migration was edited after it ran", async () => {
    await ready();
    await h.run(["up"]);
    await h.put({ ...m3, ops: [add(posts, "tags", int)] });
    h.setSchema(create(posts, { title: text, body: text, views: int, tags: int }));

    const r = await h.run(["status", "--exit-code"]);

    expect(r.code).toBe(7);
    expect(r.stdout).toContain(m3.id);
  });

  it("exits 1 and names the missing piece when the config has no adapter", async () => {
    h = await makeHarness({ config: { adapter: null } });
    await h.put(m1);

    const r = await h.run(["status"]);

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("the config has no `adapter`");
    expect(r.stderr).toContain("next: add `adapter:");
  });
});

describe("up", () => {
  it("applies every pending migration to the real data, in chain order, and journals them", async () => {
    await ready();

    const r = await h.run(["up"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("applied 3 migration(s)");
    expect((await driver().applied()).map((e) => [e.id, e.status])).toEqual(
      chain.map((f) => [f.id, "done"]),
    );
    const row = await h.store.adapter.insert(collectionAfter(chain, "posts"), {
      title: "t",
    });
    expect(await h.store.adapter.findMany(collectionAfter(chain, "posts"))).toEqual([
      row,
    ]);
  });

  it("is idempotent: a second run has nothing to apply", async () => {
    await ready();
    await h.run(["up"]);

    const r = await h.run(["up"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("nothing to apply");
    expect(await driver().applied()).toHaveLength(3);
  });

  it("--dry-run prints the plan and applies nothing", async () => {
    await ready();

    const r = await h.run(["up", "--dry-run"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`would apply ${m1.id}`);
    expect(r.stdout).toContain("addField views");
    expect(await driver().applied()).toEqual([]);
  });

  it("refuses an unapproved destructive migration (exit 6) before applying anything", async () => {
    await ready();
    await h.run(["up"]);
    const drop = mig(idAt(4, "drop_tags"), m3.id, [dropField(posts, "tags")]);
    await h.put(drop);
    h.setSchema(create(posts, { title: text, body: text, views: int }));

    const r = await h.run(["up"]);

    expect(r.code).toBe(6);
    expect(r.stderr).toContain(drop.id);
    expect(r.stderr).toContain(
      `next: review the ops, then run \`shuri-migrate up --allow-destructive ${drop.id}\``,
    );
    expect(await driver().applied()).toHaveLength(3);
  });

  it("applies it with --allow-destructive <id>, or --allow-destructive-all", async () => {
    for (const flags of [
      ["--allow-destructive", idAt(4, "drop_tags")],
      ["--allow-destructive-all"],
    ]) {
      await ready();
      await h.run(["up"]);
      await h.put(mig(idAt(4, "drop_tags"), m3.id, [dropField(posts, "tags")]));
      h.setSchema(create(posts, { title: text, body: text, views: int }));

      const r = await h.run(["up", ...flags]);

      expect(r.code).toBe(0);
      expect(await driver().applied()).toHaveLength(4);
      await h.cleanup();
    }
  });

  it("an approval for another migration does not cover this one", async () => {
    await ready();
    await h.run(["up"]);
    await h.put(mig(idAt(4, "drop_tags"), m3.id, [dropField(posts, "tags")]));
    h.setSchema(create(posts, { title: text, body: text, views: int }));

    expect((await h.run(["up", "--allow-destructive", m1.id])).code).toBe(6);
  });

  it("on a terminal lists the destructive ops and applies them only after a yes", async () => {
    await ready();
    await h.run(["up"]);
    const drop = mig(idAt(4, "drop_tags"), m3.id, [dropField(posts, "tags")]);
    await h.put(drop);
    h.setSchema(create(posts, { title: text, body: text, views: int }));

    const no = await h.run(["up"], { isTTY: true, answers: [false] });
    expect(no.code).toBe(6);
    expect(no.stdout).toContain(`${drop.id}: dropField tags`);
    expect(await driver().applied()).toHaveLength(3);

    const yes = await h.run(["up"], { isTTY: true, answers: [true] });
    expect(yes.code).toBe(0);
    expect(h.questions).toEqual(["Apply them? [y/N] ", "Apply them? [y/N] "]);
    expect(await driver().applied()).toHaveLength(4);
  });

  it("exits 5 naming the holder while another process holds the lock", async () => {
    await ready();
    await driver().acquireLock("other-process", 60_000);

    const r = await h.run(["up"]);

    expect(r.code).toBe(5);
    expect(r.stderr).toContain("other-process");
    expect(r.stderr).toContain(
      "next: wait for the holder, or run `shuri-migrate unlock --force`",
    );
    expect(await driver().applied()).toEqual([]);
  });

  it("--wait keeps retrying a busy lock for that long before giving up with exit 5", async () => {
    await ready();
    await driver().acquireLock("other-process", 60_000);
    const started = Date.now();

    const r = await h.run(["up", "--wait", "250"]);

    expect(r.code).toBe(5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it("exits 4 when the schema in code has no migration yet, and 3 on unreconciled branches", async () => {
    await ready();
    h.setSchema(
      create(posts, { title: text, body: text, views: int, tags: text, extra: text }),
    );
    const drift = await h.run(["up"]);
    expect(drift.code).toBe(4);
    expect(drift.stderr).toContain("next: run `shuri-migrate generate <name>`");

    await h.put(mig(idAt(9, "branch"), m1.id, [add(posts, "other", int)]));
    const heads = await h.run(["up"]);
    expect(heads.code).toBe(3);
    expect(heads.stderr).toContain("next: run `shuri-migrate reconcile`");
  });

  it("rejects a malformed --wait and conflicting approval flags as usage errors", async () => {
    await ready();
    expect((await h.run(["up", "--wait", "soon"])).code).toBe(2);
    expect(
      (await h.run(["up", "--allow-destructive", "x", "--allow-destructive-all"])).code,
    ).toBe(2);
  });

  it("an edited applied migration exits 7 until repair-checksum rewrites the journal", async () => {
    await ready();
    await h.run(["up"]);
    const edited = { ...m2, ops: [add(posts, "views", int), add(posts, "likes", int)] };
    await h.put(edited);
    h.setSchema(
      create(posts, { title: text, body: text, views: int, likes: int, tags: text }),
    );

    const blocked = await h.run(["up"]);
    expect(blocked.code).toBe(7);
    expect(blocked.stderr).toContain(`shuri-migrate repair-checksum ${m2.id}`);

    const repaired = await h.run(["repair-checksum", m2.id, "--yes"]);
    expect(repaired.code).toBe(0);
    expect((await driver().applied()).find((e) => e.id === m2.id)?.checksum).toBe(
      await checksumOf(edited),
    );
    expect((await h.run(["up"])).code).toBe(0);
  });

  it("a journal entry without a file exits 7", async () => {
    await ready();
    await driver().journal.markApplied({ id: idAt(7, "ghost"), checksum: "sha256:00" });

    const r = await h.run(["up"]);

    expect(r.code).toBe(7);
    expect(r.stderr).toContain(`shuri-migrate unmark ${idAt(7, "ghost")}`);
  });
});
