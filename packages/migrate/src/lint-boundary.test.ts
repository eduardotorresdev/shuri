import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdirs: string[] = [];

afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Lints `contents` as `src/<relative>` of a throwaway copy of the package's lint setup in the OS
 * temp dir, so the fixture never touches the package's own tree (and a crash leaves nothing in it).
 * @param relative - Path of the fixture under `src/`.
 * @param contents - Source of the fixture.
 * @returns oxlint's output, or "" when the file is clean.
 */
function lint(relative: string, contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "shuri-migrate-lint-"));
  workdirs.push(root);
  const config = JSON.parse(readFileSync(join(pkgRoot, ".oxlintrc.json"), "utf8")) as {
    extends: string[];
  };
  config.extends = config.extends.map((path) => resolve(pkgRoot, path));
  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify(config));
  const file = join(root, "src", relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  try {
    execFileSync("oxlint", ["-c", ".oxlintrc.json", join("src", relative)], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
    return "";
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    return `${stdout}${stderr}` || String(error);
  }
}

const NODE_IMPORT =
  'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n';

// Spawns real processes (git/oxlint); slow under parallel turbo load.
describe("node:* import boundary (lint)", { timeout: 30_000 }, () => {
  it("rejects a node: import in core source", () => {
    expect(lint("zz-fixture-core.ts", NODE_IMPORT)).toContain("no-restricted-imports");
  });

  it("rejects a node: re-export in a nested core folder", () => {
    expect(lint("graph/zz-fixture.ts", 'export { join } from "node:path";\n')).toContain(
      "no-restricted-imports",
    );
  });

  it("rejects a node: import in the shipped testing/ entry", () => {
    expect(lint("testing/zz-fixture.ts", NODE_IMPORT)).toContain("no-restricted-imports");
  });

  it("allows a node: import under src/node/**", () => {
    expect(lint("node/zz-fixture.ts", NODE_IMPORT)).toBe("");
  });

  it("allows a node: import in a test file", () => {
    expect(lint("zz-fixture.test.ts", NODE_IMPORT)).toBe("");
  });

  it("allows non-node imports in core source", () => {
    expect(
      lint(
        "zz-fixture-ok.ts",
        'import { object } from "@shuri/validate";\nexport const o = object;\n',
      ),
    ).toBe("");
  });
});
