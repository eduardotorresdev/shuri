import { parseArgs } from "node:util";
import { CliUsageError } from "./errors.js";
import type { OptionValue } from "./types.js";

export type OptionSpec = Record<
  string,
  { type: "string" | "boolean"; multiple?: boolean; short?: string }
>;

/** Options every command accepts. */
export const COMMON_OPTIONS: OptionSpec = {
  config: { type: "string" },
  dir: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

export interface ParsedArgs {
  values: Record<string, OptionValue>;
  positionals: string[];
}

/**
 * @param argv - The arguments after the command name.
 * @param options - The command's own options (the common ones are added).
 * @param arity - How many positional arguments the command takes, and their names for the message.
 * @returns The parsed values and positionals.
 * @throws {CliUsageError} For unknown options, bad values or the wrong number of arguments.
 */
export function parseCommandArgs(
  argv: readonly string[],
  options: OptionSpec,
  arity: { names: readonly string[] },
): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { ...COMMON_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new CliUsageError((error as Error).message);
  }
  const { positionals } = parsed;
  if (!parsed.values["help"] && positionals.length !== arity.names.length) {
    throw new CliUsageError(
      arity.names.length === 0
        ? `unexpected argument "${positionals[0]}"`
        : `expected ${arity.names.map((n) => `<${n}>`).join(" ")}, got ${positionals.length} argument(s)`,
    );
  }
  return { values: parsed.values as Record<string, OptionValue>, positionals };
}
