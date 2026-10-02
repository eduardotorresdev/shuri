// Integration: `generate` and `reconcile` through runCli, on a real temp directory.
import { afterEach, describe, expect, it } from "vitest";
import { checksumOf } from "../migration/checksum.js";
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
const GENERATED_1 = "20260101T000001000Z_0000_init";

let h: Harness;
afterEach(() => h.cleanup());

describe("generate", () => {
  it("writes the first migration from the schema in code and the bundle that imports it", async () => {
    h = await makeHarness();
    h.setSchema(create(posts, { title: text }));

    const r = await h.run(["generate", "init"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`generated ${GENERATED_1}`);
    expect(await h.names()).toEqual([`${GENERATED_1}.json`, "index.ts"]);
    const [file] = await h.files();
    expect(file).toEqual({
      format: 1,
      id: GENERATED_1,
      parent: null,
      ops: [{ op: "createEntity", target: posts, fields: { title: text } }],
    });
    expect(await h.read("index.ts")).toContain(
      `import m_0 from "./${GENERATED_1}.json" with { type: "json" };\n\nexport default [m_0];`,
    );
  });

  it("chains the next migration to the head and records only what changed", async () => {
    h = await makeHarness();
    h.setSchema(create(posts, { title: text }));
    await h.run(["generate", "init"]);
    h.setSchema(create(posts, { title: text, views: int }));

    const r = await h.run(["generate", "Add Views"]);

    expect(r.code).toBe(0);
    const files = await h.files();
    expect(files).toHaveLength(2);
    expect(files[1]).toMatchObject({
      id: "20260101T000002000Z_0001_add_views",
      parent: GENERATED_1,
      ops: [add(posts, "views", int)],
    });
    expect(await h.read("index.ts")).toContain("export default [m_0, m_1];");
  });

  it("says there is nothing to generate, and writes no migration, when the schema already matches", async () => {
    h = await makeHarness();
    h.setSchema(create(posts, { title: text }));
    await h.run(["generate", "init"]);

    const r = await h.run(["generate", "again", "--json"]);

    expect(r.code).toBe(0);
    expect(r.json?.result).toMatchObject({ generated: null });
    expect(await h.files()).toHaveLength(1);
  });

  it("lists destructive ops and the command that approves them", async () => {
    h = await makeHarness();
    h.setSchema(create(posts, { title: text, body: text }));
    await h.run(["generate", "init"]);
    h.setSchema(create(posts, { title: text }));

    const r = await h.run(["generate", "drop body"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("destructive (needs approval to run):");
    expect(r.stdout).toContain("dropField body");
    expect(r.stdout).toContain(
      "shuri-migrate up --allow-destructive 20260101T000002000Z_0001_drop_body",
    );
  });

  it("never infers a rename: warns about it, and honours an explicit --rename-field", async () => {
    h = await makeHarness();
    h.setSchema(create(posts, { title: text }));
    await h.run(["generate", "init"]);
    h.setSchema(create(posts, { name: text }));

    const guessed = await h.run(["generate", "rename or not"]);
    expect(guessed.stdout).toContain(
      "warning: in collection posts, dropField title and addField name",
    );
    expect((await h.files())[1].ops.map((o) => o.op)).toEqual(["addField", "dropField"]);

    await h.cleanup();
    h = await makeHarness();
    h.setSchema(create(posts, { title: text }));
    await h.run(["generate", "init"]);
    h.setSchema(create(posts, { name: text }));
    const hinted = await h.run([
      "generate",
      "rename",
      "--rename-field",
      "collection:posts.title=name",
    ]);
    expect(hinted.code).toBe(0);
    expect(hinted.stdout).not.toContain("warning");
    expect((await h.files())[1].ops).toEqual([renameField(posts, "title", "name")]);
  });

  it("renames an entity from --rename-entity", async () => {
    h = await makeHarness();
    h.setSchema(create(posts, { title: text }));
    await h.run(["generate", "init"]);
    h.setSchema(create(col("articles"), { title: text }));

    const r = await h.run([
      "generate",
      "rename posts",
      "--rename-entity",
      "collection:posts=articles",
    ]);

    expect(r.code).toBe(0);
    expect((await h.files())[1].ops).toEqual([
      { op: "renameEntity", target: posts, to: "articles" },
    ]);
  });

  it("exits 2 with a usage message for a malformed rename flag, an impossible hint and a useless name", async () => {
    h = await makeHarness();
    h.setSchema(create(posts, { title: text }));
    await h.run(["generate", "init"]);

    const malformed = await h.run(["generate", "x", "--rename-field", "posts.title"]);
    expect(malformed.code).toBe(2);
    expect(malformed.stderr).toContain("expected kind:slug.from=to");

    const impossible = await h.run([
      "generate",
      "x",
      "--rename-entity",
      "collection:ghost=other",
    ]);
    expect(impossible.code).toBe(2);
    expect(impossible.stderr).toContain("next: fix the --rename-entity");

    h.setSchema(create(posts, { title: text, views: int }));
    const name = await h.run(["generate", "!!!"]);
    expect(name.code).toBe(2);
    expect(await h.files()).toHaveLength(1);
  });

  it("reconciles parallel branches first, printing the rewrite and keeping every checksum", async () => {
    h = await makeHarness();
    const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
    const a = mig(idAt(2, "price"), root.id, [add(posts, "price", int)]);
    const b = mig(idAt(3, "stock"), root.id, [add(posts, "stock", int)]);
    await h.put(root, a, b);
    h.setSchema(create(posts, { title: text, price: int, stock: int }));

    const r = await h.run(["generate", "after merge"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`rebased ${b.id} onto ${a.id}`);
    expect(r.stdout).toContain("nothing to generate");
    const after = await h.files();
    expect(after.find((f) => f.id === b.id)?.parent).toBe(a.id);
    const rebased = after.find((f) => f.id === b.id);
    expect(rebased && (await checksumOf(rebased))).toBe(await checksumOf(b));
    expect(await h.read("index.ts")).toContain(`./${a.id}.json`);
  });

  it("exits 3 and leaves the files alone when the branches conflict", async () => {
    h = await makeHarness();
    const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
    const a = mig(idAt(2, "a"), root.id, [add(posts, "price", int)]);
    const b = mig(idAt(3, "b"), root.id, [add(posts, "price", text)]);
    await h.put(root, a, b);
    h.setSchema(create(posts, { title: text, price: int }));

    const r = await h.run(["generate", "x"]);

    expect(r.code).toBe(3);
    expect(r.stderr).toContain("resource f:collection:posts.price");
    expect(r.stderr).toContain(
      "next: edit one of the conflicting files and run `shuri-migrate reconcile`",
    );
    expect((await h.files()).find((f) => f.id === b.id)?.parent).toBe(root.id);
  });

  it("--no-reconcile refuses to diff over several heads", async () => {
    h = await makeHarness();
    const root = mig(idAt(1, "init"), null, [create(posts, { title: text })]);
    await h.put(
      root,
      mig(idAt(2, "a"), root.id, [add(posts, "price", int)]),
      mig(idAt(3, "b"), root.id, [add(posts, "stock", int)]),
    );
    h.setSchema(create(posts, { title: text }));

    const r = await h.run(["generate", "x", "--no-reconcile"]);

    expect(r.code).toBe(3);
    expect(r.stderr).toContain("next: run `shuri-migrate reconcile`");
  });

  it("a rename and an alter in one run keep the diff order of the plan", async () => {
    h = await makeHarness();
    h.setSchema(create(posts, { title: text }));
    await h.run(["generate", "init"]);
    h.setSchema(create(posts, { name: textarea }));

    await h.run(["generate", "x", "--rename-field", "collection:posts.title=name"]);

    expect((await h.files())[1].ops).toEqual([
      renameField(posts, "title", "name"),
      alter(posts, "name", text, textarea),
    ]);
  });
});
