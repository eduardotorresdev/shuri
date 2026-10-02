import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedSchema } from "@shuri/core";
import {
  func,
  objectOf,
  optional,
  string,
  validate,
  formatIssue,
  type Validator,
} from "@shuri/validate";
import { unknownKey } from "../schema/validator.js";
import { MigrateConfigError } from "./errors.js";

export interface MigrateConfig {
  /** Migrations directory, relative to the config file (default `migrations`). */
  dir?: string;
  /** The schema in code; usually `() => resolveSchema(appConfig)`. */
  schema: () => ResolvedSchema | Promise<ResolvedSchema>;
  /** The store adapter; must be `Migratable` for `status`, `up`, `baseline` and the other commands that touch a database. */
  adapter?: () => object | Promise<object>;
  /** Git ref (e.g. `origin/main`) whose migrations are frozen: reconciliation never rebases them. */
  frozenRef?: string;
  /** Where `bundle` writes, relative to the config file (default `<dir>/index.ts`). */
  bundle?: { out?: string };
}

/** The default config file name, looked up in the working directory. */
export const DEFAULT_CONFIG_FILE = "shuri.migrate.ts";

/**
 * Identity helper that types a config file's default export.
 * @param config - The config.
 * @returns The same config.
 */
export function defineMigrateConfig(config: MigrateConfig): MigrateConfig {
  return config;
}

const configValidator: Validator<unknown> = objectOf<Record<string, unknown>>(
  {
    dir: optional(string()),
    schema: func('"schema" must be a function returning the resolved schema'),
    adapter: optional(func('"adapter" must be a function returning the store adapter')),
    frozenRef: optional(string()),
    bundle: optional(
      objectOf<Record<string, unknown>>(
        { out: optional(string()) },
        "must be an object",
        { unknownKeyMessage: unknownKey },
      ),
    ),
  },
  "must be an object",
  { unknownKeyMessage: unknownKey },
);

const ERASABLE_HINT =
  "use only erasable TypeScript syntax (no enums, namespaces or parameter properties) and `.ts` import specifiers";

/**
 * Turns the failures of a native `import()` into what the developer should do about them.
 * @param path - The config file.
 * @param error - What `import()` threw.
 * @returns The error to report.
 */
export function explainLoadError(path: string, error: unknown): MigrateConfigError {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ERR_MODULE_NOT_FOUND") {
    return new MigrateConfigError(
      path,
      `a module it imports was not found (${message}); workspace packages resolve to their \`dist\``,
      "run `pnpm build`, then retry",
    );
  }
  if (code === "ERR_UNSUPPORTED_SYNTAX" || code === "ERR_UNKNOWN_FILE_EXTENSION") {
    return new MigrateConfigError(
      path,
      `cannot be loaded as TypeScript (${message})`,
      ERASABLE_HINT,
    );
  }
  if (error instanceof SyntaxError) {
    return new MigrateConfigError(path, `syntax error: ${message}`, ERASABLE_HINT);
  }
  return new MigrateConfigError(
    path,
    `failed while loading: ${message}`,
    "fix the error above and retry",
  );
}

/**
 * Loads the config file with the runtime's native `import()` (Node >= 22.18 strips the types), so
 * the file may only use erasable syntax and `.ts` imports.
 * @param path - The file (default `./shuri.migrate.ts`); relative paths resolve from the working directory.
 * @returns The validated default export.
 * @throws {MigrateConfigError} If the file is missing, cannot be imported or has the wrong shape.
 */
export async function loadConfig(
  path: string = DEFAULT_CONFIG_FILE,
): Promise<MigrateConfig> {
  const absolute = isAbsolute(path) ? path : resolve(path);
  if (
    !(await stat(absolute).then(
      (s) => s.isFile(),
      () => false,
    ))
  ) {
    throw new MigrateConfigError(
      absolute,
      "config file not found",
      `create it with \`export default defineMigrateConfig({ schema: () => resolveSchema(appConfig) })\`, or pass --config <file>`,
    );
  }
  let loaded: { default?: unknown };
  try {
    loaded = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  } catch (error) {
    throw explainLoadError(absolute, error);
  }
  const issues = validate(loaded.default, configValidator);
  if (issues.length > 0) {
    throw new MigrateConfigError(
      absolute,
      `invalid config (the default export must be defineMigrateConfig({...})):\n${issues.map((i) => `  ${formatIssue(i)}`).join("\n")}`,
      "fix the config",
    );
  }
  return loaded.default as MigrateConfig;
}
