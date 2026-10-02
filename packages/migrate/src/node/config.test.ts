import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineMigrateConfig, explainLoadError, loadConfig } from "./config.js";
import { MigrateConfigError } from "./errors.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "shuri-migrate-config-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function configFile(source: string, name = "shuri.migrate.ts"): Promise<string> {
  const path = join(root, name);
  await writeFile(path, source);
  return path;
}

const failure = async (path: string) => {
  const error = await loadConfig(path).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(MigrateConfigError);
  return error as MigrateConfigError;
};

describe("defineMigrateConfig", () => {
  it("returns the config untouched", () => {
    const config = { schema: () => ({ collections: [], globals: [] }) };
    expect(defineMigrateConfig(config)).toBe(config);
  });
});

describe("loadConfig", () => {
  it("imports the default export of a TypeScript file and keeps its functions callable", async () => {
    const path = await configFile(`
      const schema = { collections: [], globals: [] };
      export default {
        dir: "db/migrations",
        frozenRef: "origin/main",
        bundle: { out: "db/index.ts" },
        schema: (): typeof schema => schema,
        adapter: () => ({ name: "adapter" }),
      };
    `);

    const config = await loadConfig(path);

    expect(config.dir).toBe("db/migrations");
    expect(config.frozenRef).toBe("origin/main");
    expect(config.bundle).toEqual({ out: "db/index.ts" });
    expect(await config.schema()).toEqual({ collections: [], globals: [] });
    expect(await config.adapter?.()).toEqual({ name: "adapter" });
  });

  it("resolves a relative path from the working directory", async () => {
    await configFile(
      "export default { schema: () => ({ collections: [], globals: [] }) };",
    );
    const previous = process.cwd();
    process.chdir(root);
    try {
      expect(await loadConfig("shuri.migrate.ts")).toMatchObject({
        schema: expect.any(Function),
      });
    } finally {
      process.chdir(previous);
    }
  });

  it("reports a missing file with the way to create it", async () => {
    const error = await failure(join(root, "nope.ts"));
    expect(error.message).toContain("config file not found");
    expect(error.next).toContain("defineMigrateConfig");
  });

  it("rejects a default export of the wrong shape, listing each problem", async () => {
    const path = await configFile(
      `export default { schema: 3, adapter: "x", extra: true };`,
    );
    const error = await failure(path);
    expect(error.message).toContain('schema: "schema" must be a function');
    expect(error.message).toContain("adapter:");
    expect(error.message).toContain('unknown property "extra"');
  });

  it("rejects a file with no default export", async () => {
    const error = await failure(await configFile("export const schema = () => 1;"));
    expect(error.message).toContain("invalid config");
  });

  it("wraps an error thrown while the file loads", async () => {
    const error = await failure(await configFile(`throw new Error("boom");`));
    expect(error.message).toContain("failed while loading: boom");
  });
});

const explain = (error: unknown) => explainLoadError("/p/shuri.migrate.ts", error);

describe("explainLoadError", () => {
  it("tells the developer to build when a workspace package is not found", () => {
    const error = explain(
      Object.assign(new Error("Cannot find package"), { code: "ERR_MODULE_NOT_FOUND" }),
    );
    expect(error.next).toBe("run `pnpm build`, then retry");
    expect(error.message).toContain("Cannot find package");
  });

  it("points at erasable syntax for unsupported syntax, unknown extensions and syntax errors", () => {
    for (const cause of [
      Object.assign(new Error("enum"), { code: "ERR_UNSUPPORTED_SYNTAX" }),
      Object.assign(new Error("ext"), { code: "ERR_UNKNOWN_FILE_EXTENSION" }),
      new SyntaxError("Unexpected token"),
    ]) {
      expect(explain(cause).next).toContain("erasable TypeScript syntax");
    }
  });

  it("keeps the message of anything else", () => {
    const error = explain("plain string");
    expect(error.message).toContain("failed while loading: plain string");
    expect(error.path).toBe("/p/shuri.migrate.ts");
  });
});
