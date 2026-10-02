import { parseCommandArgs } from "./cli-args.js";
import { COMMANDS, type CommandSpec } from "./commands/index.js";
import { CliUsageError } from "./errors.js";
import { describeFailure } from "./failure.js";
import { openProject } from "./project.js";
import type { CliDeps, CliIO, Env, Outcome } from "./types.js";

export type { CliDeps, CliIO } from "./types.js";

const JSON_VERSION = 1;

const COMMON_HELP: readonly (readonly [string, string])[] = [
  ["--config <file>", "config file (default ./shuri.migrate.ts)"],
  ["--dir <path>", "migrations directory (overrides the config)"],
  ["--json", "machine-readable output on stdout"],
  ["-h, --help", "show help"],
];

const table = (rows: readonly (readonly [string, string])[]) => {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
};

/**
 * @returns The top-level help text.
 */
export function usage(): string {
  return [
    "usage: shuri-migrate <command> [options]",
    "",
    "commands:",
    ...table(Object.entries(COMMANDS).map(([name, c]) => [name, c.summary])),
    "",
    "options (every command):",
    ...table(COMMON_HELP),
    "",
    "exit codes: 0 ok, 1 error, 2 usage, 3 conflict / several heads, 4 pending or drift, 5 locked,",
    "            6 destructive approval needed, 7 checksum mismatch or unknown applied migration",
  ].join("\n");
}

function commandUsage(name: string, spec: CommandSpec): string {
  const args = spec.args.map((a) => ` <${a}>`).join("");
  return [
    `usage: shuri-migrate ${name}${args} [options]`,
    "",
    spec.summary,
    "",
    "options:",
    ...table([...spec.help, ...COMMON_HELP]),
  ].join("\n");
}

function emit(
  io: CliIO,
  json: boolean,
  command: string,
  outcome: Outcome | Error,
): number {
  if (outcome instanceof Error) {
    const failure = describeFailure(outcome);
    if (json) {
      io.stdout(
        `${JSON.stringify({ version: JSON_VERSION, command, ok: false, error: { name: failure.name, message: failure.message, details: failure.details } })}\n`,
      );
    } else {
      io.stderr(`error: ${failure.message}\nnext: ${failure.next}\n`);
    }
    return failure.exit;
  }
  const exit = outcome.exit ?? 0;
  io.stdout(
    json
      ? `${JSON.stringify({ version: JSON_VERSION, command, ok: exit === 0, result: outcome.result })}\n`
      : `${outcome.text}\n`,
  );
  return exit;
}

const randomHex4 = () =>
  [...globalThis.crypto.getRandomValues(new Uint8Array(2))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * Runs the CLI in-process: parses `argv`, runs the command, prints through `io` and returns the exit
 * code (it never calls `process.exit`), so tests drive it directly.
 * @param argv - The arguments after `shuri-migrate`.
 * @param io - Output, working directory, terminal-ness and the optional yes/no prompt.
 * @param deps - Test seams: config loader, clock, randomness, sleep.
 * @returns The exit code (see `usage()`).
 */
export async function runCli(
  argv: readonly string[],
  io: CliIO,
  deps: CliDeps = {},
): Promise<number> {
  const [name, ...rest] = argv;
  const json = argv.includes("--json");
  try {
    if (name === undefined || name === "--help" || name === "-h" || name === "help") {
      (name === undefined ? io.stderr : io.stdout)(`${usage()}\n`);
      return name === undefined ? 2 : 0;
    }
    const spec = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (!spec) throw new CliUsageError(`unknown command "${name}"`);
    const { values, positionals } = parseCommandArgs(rest, spec.options, {
      names: spec.args,
    });
    if (values["help"]) {
      io.stdout(`${commandUsage(name, spec)}\n`);
      return 0;
    }
    let project: Promise<Awaited<ReturnType<typeof openProject>>> | undefined;
    const env: Env = {
      io,
      deps,
      values,
      positionals,
      project: () =>
        (project ??= openProject(io, deps, {
          config: typeof values["config"] === "string" ? values["config"] : undefined,
          dir: typeof values["dir"] === "string" ? values["dir"] : undefined,
        })),
      now: deps.now ?? (() => new Date()),
      random4hex: deps.random4hex ?? randomHex4,
    };
    return emit(io, json, name, await spec.run(env));
  } catch (error) {
    return emit(
      io,
      json,
      name ?? "",
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
