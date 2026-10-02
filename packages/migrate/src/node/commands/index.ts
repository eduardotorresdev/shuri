import type { OptionSpec } from "../cli-args.js";
import type { Env, Outcome } from "../types.js";
import { baseline } from "./baseline.js";
import { bundle } from "./bundle.js";
import { check } from "./check.js";
import { generate } from "./generate.js";
import { markApplied, repairChecksum, unmark } from "./journal.js";
import { reconcile } from "./reconcile.js";
import { render } from "./render.js";
import { status } from "./status.js";
import { unlock } from "./unlock.js";
import { up } from "./up.js";

export interface CommandSpec {
  summary: string;
  /** Names of the positional arguments, in order. */
  args: readonly string[];
  /** Options beyond `--config`, `--dir`, `--json`, `--help`: `[flag syntax, description]` per option. */
  options: OptionSpec;
  help: readonly (readonly [string, string])[];
  run(env: Env): Promise<Outcome>;
}

const yes: OptionSpec = { yes: { type: "boolean" } };
const yesHelp = [
  ["--yes", "skip the confirmation (required without a terminal)"],
] as const;

export const COMMANDS: Record<string, CommandSpec> = {
  generate: {
    summary: "diff the schema in code against the migrations and write a new migration",
    args: ["name"],
    options: {
      "rename-entity": { type: "string", multiple: true },
      "rename-field": { type: "string", multiple: true },
      "no-reconcile": { type: "boolean" },
    },
    help: [
      ["--rename-entity kind:from=to", "declare an entity rename (repeatable)"],
      [
        "--rename-field kind:slug.from=to",
        "declare a field rename; slug is the NEW slug (repeatable)",
      ],
      ["--no-reconcile", "do not rebase parallel branches first"],
    ],
    run: generate,
  },
  reconcile: {
    summary: "rebase parallel branches into one linear chain",
    args: [],
    options: { "dry-run": { type: "boolean" } },
    help: [["--dry-run", "show the rewrites without writing"]],
    run: reconcile,
  },
  status: {
    summary: "compare the migration files with the database",
    args: [],
    options: { "exit-code": { type: "boolean" } },
    help: [["--exit-code", "exit 4 when something is pending or the schema drifted"]],
    run: status,
  },
  check: {
    summary: "validate files, chain, schema drift and bundle (no database)",
    args: [],
    options: {},
    help: [],
    run: check,
  },
  up: {
    summary: "apply pending migrations",
    args: [],
    options: {
      "allow-destructive": { type: "string" },
      "allow-destructive-all": { type: "boolean" },
      "dry-run": { type: "boolean" },
      wait: { type: "string" },
    },
    help: [
      ["--allow-destructive <id,...>", "approve destructive ops of these migrations"],
      ["--allow-destructive-all", "approve every destructive op"],
      ["--dry-run", "plan only, change nothing"],
      ["--wait <ms>", "wait this long for a busy lock"],
    ],
    run: up,
  },
  baseline: {
    summary: "adopt an existing database: record the chain as applied without running it",
    args: [],
    options: { to: { type: "string" } },
    help: [["--to <id>", "record the chain up to this migration (default: the head)"]],
    run: baseline,
  },
  unlock: {
    summary: "show the migration lock; --force releases it",
    args: [],
    options: { force: { type: "boolean" } },
    help: [["--force", "release the lock whoever holds it"]],
    run: unlock,
  },
  "mark-applied": {
    summary: "record a migration as applied without running it",
    args: ["id"],
    options: yes,
    help: yesHelp,
    run: markApplied,
  },
  unmark: {
    summary: "remove a migration from the journal",
    args: ["id"],
    options: yes,
    help: yesHelp,
    run: unmark,
  },
  "repair-checksum": {
    summary: "rewrite a journal checksum from the file",
    args: ["id"],
    options: yes,
    help: yesHelp,
    run: repairChecksum,
  },
  render: {
    summary: "print the driver's SQL for a migration (drivers that support it)",
    args: ["id"],
    options: {},
    help: [],
    run: render,
  },
  bundle: {
    summary: "generate the importable index of the migrations",
    args: [],
    options: {},
    help: [],
    run: bundle,
  },
};
