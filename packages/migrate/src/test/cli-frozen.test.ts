// Integration: `frozenRef` read from a real git repository keeps production migrations in place.
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { idAt, mig } from "../migration/test-support.js";
import { add, col, create, int, text } from "../ops/test-support.js";
import { makeHarness, type Harness } from "./cli-support.js";

const posts = col("posts");
let h: Harness;
afterEach(() => h.cleanup());

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stdio: "pipe",
  });

// A repo whose HEAD already has `root` and `inMain` (id 5); `local` (id 3) exists only in the working tree.
async function repo() {
  h = await makeHarness({ config: { frozenRef: "HEAD" } });
  const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
  const inMain = mig(idAt(5, "from_main"), root.id, [add(posts, "stock", int)]);
  await h.put(root, inMain);
  git(h.root, "init", "-q");
  git(h.root, "add", ".");
  git(h.root, "commit", "-q", "-m", "main");
  const local = mig(idAt(3, "local"), root.id, [add(posts, "price", int)]);
  await h.put(local);
  return { root, inMain, local };
}

// Spawns real processes (git/oxlint); slow under parallel turbo load.
describe("frozenRef", { timeout: 30_000 }, () => {
  it("rebases the local branch onto the migration already in the ref, even though its id is larger", async () => {
    const { inMain, local } = await repo();

    const r = await h.run(["reconcile"]);

    expect(r.code).toBe(0);
    const files = await h.files();
    expect(files.find((f) => f.id === local.id)?.parent).toBe(inMain.id);
    expect(files.find((f) => f.id === inMain.id)).toEqual(inMain);
  });

  it("without frozenRef the same files rebase the migration with the larger id instead", async () => {
    h = await makeHarness();
    const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
    const inMain = mig(idAt(5, "from_main"), root.id, [add(posts, "stock", int)]);
    const local = mig(idAt(3, "local"), root.id, [add(posts, "price", int)]);
    await h.put(root, inMain, local);

    await h.run(["reconcile"]);

    expect((await h.files()).find((f) => f.id === inMain.id)?.parent).toBe(local.id);
  });

  it("exits 3 (FrozenDivergence) when both branches are already in the ref", async () => {
    h = await makeHarness({ config: { frozenRef: "HEAD" } });
    const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
    await h.put(
      root,
      mig(idAt(2, "a"), root.id, [add(posts, "price", int)]),
      mig(idAt(3, "b"), root.id, [add(posts, "stock", int)]),
    );
    git(h.root, "init", "-q");
    git(h.root, "add", ".");
    git(h.root, "commit", "-q", "-m", "both");

    const r = await h.run(["reconcile"]);

    expect(r.code).toBe(3);
    expect(r.stderr).toContain("corrective migration");
  });

  it("exits 1 with the git error when branches need reconciling and the ref does not exist", async () => {
    h = await makeHarness({ config: { frozenRef: "origin/nowhere" } });
    const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
    await h.put(
      root,
      mig(idAt(2, "a"), root.id, [add(posts, "price", int)]),
      mig(idAt(3, "b"), root.id, [add(posts, "stock", int)]),
    );
    git(h.root, "init", "-q");

    const r = await h.run(["reconcile"]);

    expect(r.code).toBe(1);
    expect(r.stderr).toContain('cannot read migrations at git ref "origin/nowhere"');
    expect(r.stderr).toContain("next: fetch the ref");
  });

  it("never asks git for a linear chain, so a clone without the ref still works", async () => {
    h = await makeHarness({ config: { frozenRef: "origin/nowhere" } });
    await h.put(mig(idAt(1, "init"), null, [create(posts, { title: text })]));
    h.setSchema(create(posts, { title: text }));

    expect((await h.run(["reconcile"])).code).toBe(0);
    expect((await h.run(["generate", "x"])).code).toBe(0);
  });
});
