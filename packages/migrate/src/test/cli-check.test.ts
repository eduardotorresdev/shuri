// Integration: `check`, `bundle` and the command-line surface (usage errors, --json envelope, help).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { idAt, mig } from "../migration/test-support.js";
import { add, col, create, dropField, int, text } from "../ops/test-support.js";
import { chain, m1 } from "../runner/test-support.js";
import { makeHarness, type Harness } from "./cli-support.js";

const posts = col("posts");
const fullSchema = () =>
  create(posts, { title: text, body: text, views: int, tags: text });
let h: Harness;
afterEach(() => h.cleanup());

async function ready(options?: Parameters<typeof makeHarness>[0]) {
  h = await makeHarness(options);
  await h.put(...chain);
  h.setSchema(fullSchema());
  await h.run(["bundle"]);
}

describe("check", () => {
  it("passes on a consistent project, and warns that frozenRef is not configured", async () => {
    await ready();

    const r = await h.run(["check"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "3 migration(s), one head, chain replays, no drift, bundle current",
    );
    expect(r.stdout).toContain("warning: frozenRef is not configured");
  });

  it("does not warn when frozenRef is set, and needs no database", async () => {
    await ready({ config: { frozenRef: "origin/main", adapter: null } });
    const r = await h.run(["check"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("warning");
  });

  it("exits 4 when the schema in code has changes no migration records", async () => {
    await ready();
    h.setSchema(
      create(posts, { title: text, body: text, views: int, tags: text, extra: int }),
    );

    const r = await h.run(["check", "--json"]);

    expect(r.code).toBe(4);
    expect(r.json?.ok).toBe(false);
    expect(JSON.stringify(r.json?.result)).toContain("addField extra");
  });

  it("exits 4 when the bundle is missing or stale", async () => {
    await ready();
    await writeFile(join(h.migrationsDir, "index.ts"), "export default [];\n");
    const stale = await h.run(["check"]);
    expect(stale.code).toBe(4);
    expect(stale.stdout).toContain("is stale (run `shuri-migrate bundle`)");

    await h.cleanup();
    h = await makeHarness();
    await h.put(...chain);
    h.setSchema(fullSchema());
    const missing = await h.run(["check"]);
    expect(missing.code).toBe(4);
    expect(missing.stdout).toContain("is missing");
  });

  it("exits 3 for several heads", async () => {
    await ready();
    await h.put(mig(idAt(9, "branch"), m1.id, [add(posts, "other", int)]));
    const heads = await h.run(["check"]);
    expect(heads.code).toBe(3);
    expect(heads.stderr).toContain("next: run `shuri-migrate reconcile`");
  });

  it("exits 1 listing every file that is not a valid migration", async () => {
    await ready();
    await writeFile(
      join(h.migrationsDir, "20260101T000009000Z_0000_bad.json"),
      '{ "format": 2 }',
    );
    await writeFile(
      join(h.migrationsDir, "20260101T000008000Z_0000_worse.json"),
      "not json",
    );
    const invalid = await h.run(["check"]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("2 invalid migration file(s)");
    expect(invalid.stderr).toContain("is not valid JSON");
  });

  it("exits 1 when the chain does not replay", async () => {
    await ready();
    await h.put(mig(idAt(4, "bad"), chain[2].id, [add(col("ghost"), "x", text)]));
    const r = await h.run(["check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("next: fix the migration that does not replay");
  });

  it("prints the driver's own configuration warnings, without failing", async () => {
    await ready({
      config: { frozenRef: "origin/main" },
      driver: (d) => ({ ...d, warnings: () => ["autoIndex is on"] }),
    });
    const r = await h.run(["check", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json?.result?.warnings).toEqual(["autoIndex is on"]);
  });

  it("applies the driver's limits to the replayed schema", async () => {
    await ready({
      driver: (d) => ({
        ...d,
        validateSnapshot: () => [
          { path: "collections.posts", message: "too many columns" },
        ],
      }),
    });
    const r = await h.run(["check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("too many columns");
  });
});

describe("bundle", () => {
  it("imports every migration in chain order as JSON and exports them as one array", async () => {
    h = await makeHarness();
    await h.put(...chain);

    const r = await h.run(["bundle"]);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("(3 migrations)");
    const lines = (await h.read("index.ts")).split("\n");
    expect(lines.filter((l) => l.startsWith("import "))).toEqual(
      chain.map((f, n) => `import m_${n} from "./${f.id}.json" with { type: "json" };`),
    );
    expect(lines).toContain("export default [m_0, m_1, m_2];");
  });

  it("an empty directory yields an empty array", async () => {
    h = await makeHarness();
    await h.run(["bundle"]);
    expect(await h.read("index.ts")).toContain("export default [];");
  });

  it("goes where `bundle.out` says, importing from the migrations directory", async () => {
    h = await makeHarness({ config: { bundle: { out: "generated/migrations.ts" } } });
    await h.put(m1);

    await h.run(["bundle"]);

    const source = await readFile(join(h.root, "generated", "migrations.ts"), "utf8");
    expect(source).toContain(`import m_0 from "../migrations/${m1.id}.json"`);
  });

  it("refuses unreconciled branches (exit 3)", async () => {
    h = await makeHarness();
    await h.put(m1, mig(idAt(2, "a"), m1.id), mig(idAt(3, "b"), m1.id));
    expect((await h.run(["bundle"])).code).toBe(3);
  });
});

describe("command line", () => {
  it("prints the help with exit 0, per command and overall, and exit 2 with no command", async () => {
    h = await makeHarness();
    const top = await h.run(["--help"]);
    expect(top.code).toBe(0);
    for (const name of [
      "generate",
      "reconcile",
      "status",
      "check",
      "up",
      "baseline",
      "unlock",
      "mark-applied",
      "unmark",
      "repair-checksum",
      "render",
      "bundle",
    ]) {
      expect(top.stdout).toContain(`  ${name}`);
    }
    expect(top.stdout).toContain("7 checksum mismatch");

    const one = await h.run(["up", "--help"]);
    expect(one.code).toBe(0);
    expect(one.stdout).toContain("--allow-destructive <id,...>");

    const none = await h.run([]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("usage: shuri-migrate <command>");
  });

  it("exits 2 for unknown commands, unknown flags and the wrong number of arguments", async () => {
    h = await makeHarness();
    const unknown = await h.run(["frobnicate"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('unknown command "frobnicate"');
    expect(unknown.stderr).toContain("next: run `shuri-migrate --help`");

    expect((await h.run(["status", "--bogus"])).code).toBe(2);
    const missing = await h.run(["generate"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("expected <name>");
    expect((await h.run(["status", "extra"])).code).toBe(2);
    expect((await h.run(["toString"])).code).toBe(2);
  });

  it("--json reports errors on stdout in the versioned envelope, with nothing on stderr", async () => {
    await ready();
    await h.run(["up"]);
    await h.put(mig(idAt(4, "drop"), chain[2].id, [dropField(posts, "tags")]));
    h.setSchema(create(posts, { title: text, body: text, views: int }));

    const r = await h.run(["up", "--json"]);

    expect(r.code).toBe(6);
    expect(r.stderr).toBe("");
    expect(r.json).toEqual({
      version: 1,
      command: "up",
      ok: false,
      error: {
        name: "DestructiveMigrationError",
        message: expect.stringContaining("destructive"),
        details: {
          items: [
            { migration: idAt(4, "drop"), op: "dropField tags in collection posts" },
          ],
        },
      },
    });
  });

  it("--json on a usage error still answers in the envelope", async () => {
    h = await makeHarness();
    const r = await h.run(["nope", "--json"]);
    expect(r.code).toBe(2);
    expect(r.json).toMatchObject({
      version: 1,
      ok: false,
      error: { name: "CliUsageError" },
    });
  });

  it("--dir overrides the configured directory", async () => {
    h = await makeHarness();
    await h.put(m1);
    const same = await h.run(["bundle", "--dir", "migrations"]);
    expect(same.stdout).toContain("(1 migration)");
    const elsewhere = await h.run(["bundle", "--dir", "other"]);
    expect(elsewhere.stdout).toContain("(0 migrations)");
  });
});
