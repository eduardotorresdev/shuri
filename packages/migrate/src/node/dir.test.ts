import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationFileError } from "../errors.js";
import { idAt, mig } from "../migration/test-support.js";
import { serializeMigration } from "../migration/serialize.js";
import { add, col, create, int, text } from "../ops/test-support.js";
import { fsMigrationsDir } from "./dir.js";
import { MigrationsDirError } from "./errors.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "shuri-migrate-dir-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const a = mig(idAt(1, "init"), null, [create(col("posts"), { title: text })]);
const b = mig(idAt(2, "views"), a.id, [add(col("posts"), "views", int)]);

describe("fsMigrationsDir", () => {
  it("lists nothing for a directory that does not exist yet", async () => {
    expect(await fsMigrationsDir(join(root, "missing")).list()).toEqual([]);
  });

  it("writes <id>.json in the canonical serialisation, creating the directory", async () => {
    const path = join(root, "deep", "migrations");
    await fsMigrationsDir(path).write(a);
    expect(await readFile(join(path, `${a.id}.json`), "utf8")).toBe(
      serializeMigration(a),
    );
  });

  it("round-trips files and lists them ordered by id whatever the write order", async () => {
    const dir = fsMigrationsDir(root);
    await dir.write(b);
    await dir.write(a);
    expect(await dir.list()).toEqual([a, b]);
  });

  it("overwrites a file when written again (a rebase rewrites `parent`)", async () => {
    const dir = fsMigrationsDir(root);
    await dir.write(b);
    await dir.write({ ...b, parent: null });
    expect((await dir.list())[0].parent).toBeNull();
  });

  it("ignores the generated index.ts and every other non-JSON file", async () => {
    await writeFile(join(root, "index.ts"), "export default [];");
    await writeFile(join(root, "README.md"), "notes");
    const dir = fsMigrationsDir(root);
    await dir.write(a);
    expect(await dir.list()).toEqual([a]);
  });

  it("aggregates every invalid file in one error, in a stable order", async () => {
    const dir = fsMigrationsDir(root);
    await dir.write(a);
    await writeFile(join(root, "20260101T000009000Z_0000_z.json"), "{ not json");
    await writeFile(
      join(root, "20260101T000005000Z_0000_y.json"),
      '{"format":1,"id":"other","parent":null,"ops":[]}',
    );

    const error = await dir.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigrationsDirError);
    const dirError = error as MigrationsDirError;
    expect(dirError.errors).toHaveLength(2);
    expect(dirError.errors.every((e) => e instanceof MigrationFileError)).toBe(true);
    expect(dirError.errors.map((e) => e.source.split("/").pop())).toEqual([
      "20260101T000005000Z_0000_y.json",
      "20260101T000009000Z_0000_z.json",
    ]);
    expect(dirError.message).toContain("2 invalid migration file(s)");
    expect(dirError.message).toContain("is not valid JSON");
  });

  it("rejects a file whose id differs from its name", async () => {
    await writeFile(join(root, `${idAt(7, "renamed")}.json`), serializeMigration(a));
    await expect(fsMigrationsDir(root).list()).rejects.toThrow(
      /must equal the file name/,
    );
  });
});
