import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitRefError } from "./errors.js";
import { frozenIdsAt } from "./git.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "shuri-migrate-git-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: root,
    stdio: "pipe",
  });

async function commit(files: Record<string, string>, message = "c") {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), content);
  }
  git("add", ".");
  git("commit", "-q", "-m", message);
}

// Spawns real processes (git/oxlint); slow under parallel turbo load.
describe("frozenIdsAt", { timeout: 30_000 }, () => {
  it("returns the ids of the JSON files the ref has in the directory, not the working tree's", async () => {
    git("init", "-q");
    await commit({
      "migrations/20260101T000001000Z_0000_a.json": "{}",
      "migrations/index.ts": "x",
      "elsewhere/20260101T000009000Z_0000_other.json": "{}",
    });
    await writeFile(join(root, "migrations/20260101T000002000Z_0000_new.json"), "{}");

    const ids = await frozenIdsAt("HEAD", join(root, "migrations"));

    expect([...ids]).toEqual(["20260101T000001000Z_0000_a"]);
  });

  it("reads an older ref even after later commits added migrations", async () => {
    git("init", "-q");
    await commit({ "migrations/20260101T000001000Z_0000_a.json": "{}" });
    await commit({ "migrations/20260101T000002000Z_0000_b.json": "{}" });

    expect([...(await frozenIdsAt("HEAD~1", join(root, "migrations")))]).toEqual([
      "20260101T000001000Z_0000_a",
    ]);
  });

  it("is empty when the ref has no such directory, or the directory does not exist yet", async () => {
    git("init", "-q");
    await commit({ "README.md": "x" });
    await mkdir(join(root, "migrations"));

    expect((await frozenIdsAt("HEAD", join(root, "migrations"))).size).toBe(0);
    expect((await frozenIdsAt("HEAD", join(root, "not-yet"))).size).toBe(0);
  });

  it("raises GitRefError with git's message for a ref that does not exist", async () => {
    git("init", "-q");
    await commit({ "migrations/20260101T000001000Z_0000_a.json": "{}" });

    const error = await frozenIdsAt("origin/main", join(root, "migrations")).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(GitRefError);
    expect((error as GitRefError).ref).toBe("origin/main");
    expect((error as GitRefError).message).toContain("origin/main");
  });
});
