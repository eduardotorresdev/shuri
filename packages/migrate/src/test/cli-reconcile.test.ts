// Integration: `reconcile` through runCli, on a real temp directory.
import { afterEach, describe, expect, it } from "vitest";
import { idAt, mig } from "../migration/test-support.js";
import {
  add,
  alter,
  col,
  create,
  int,
  renameField,
  text,
  textarea,
} from "../ops/test-support.js";
import { makeHarness, type Harness } from "./cli-support.js";

const posts = col("posts");
let h: Harness;
afterEach(() => h.cleanup());

describe("reconcile", () => {
  async function branched() {
    h = await makeHarness();
    const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
    const a = mig(idAt(2, "price"), root.id, [add(posts, "price", int)]);
    const b = mig(idAt(3, "stock"), root.id, [add(posts, "stock", int)]);
    await h.put(root, a, b);
    return { root, a, b };
  }

  it("--dry-run reports the rewrite and writes nothing", async () => {
    const { a, b } = await branched();

    const r = await h.run(["reconcile", "--dry-run"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`would rebase ${b.id} onto ${a.id}\n`);
    expect((await h.files()).find((f) => f.id === b.id)?.parent).not.toBe(a.id);
    expect(await h.names()).not.toContain("index.ts");
  });

  it("rewrites only `parent`, then bundles the linear chain", async () => {
    const { root, a, b } = await branched();
    const before = await h.read(`${b.id}.json`);

    const r = await h.run(["reconcile"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`rebased ${b.id} onto ${a.id}`);
    expect(await h.read(`${b.id}.json`)).toBe(
      before.replace(`"parent": "${root.id}"`, `"parent": "${a.id}"`),
    );
    const bundle = await h.read("index.ts");
    expect(bundle.indexOf(a.id)).toBeLessThan(bundle.indexOf(b.id));
  });

  it("is a no-op, and says so, on a chain that is already linear", async () => {
    h = await makeHarness();
    await h.put(mig(idAt(1, "init"), null, [create(posts, { title: text })]));

    const r = await h.run(["reconcile"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe("already linear: nothing to reconcile\n");
  });

  it("exits 3 with the conflict diagnostic when branches do not commute", async () => {
    h = await makeHarness();
    const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
    await h.put(
      root,
      mig(idAt(2, "a"), root.id, [renameField(posts, "title", "name")]),
      mig(idAt(3, "b"), root.id, [alter(posts, "title", text, textarea)]),
    );

    const r = await h.run(["reconcile"]);

    expect(r.code).toBe(3);
    expect(r.stderr).toContain("resource f:collection:posts.title");
    expect(r.stderr).toContain("renameField title→name");
  });

  it("--json wraps the plan in the versioned envelope", async () => {
    const { a, b } = await branched();

    const r = await h.run(["reconcile", "--dry-run", "--json"]);

    expect(r.json).toEqual({
      version: 1,
      command: "reconcile",
      ok: true,
      result: {
        rewrites: [{ id: b.id, parent: a.id }],
        chain: [expect.any(String), a.id, b.id],
        dryRun: true,
      },
    });
    expect(r.stderr).toBe("");
  });
});
