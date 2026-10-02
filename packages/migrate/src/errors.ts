import { ValidationError, formatIssues, type Issue } from "@shuri/validate";
import { formatConflict } from "./graph/format-conflict.js";
import type { CommuteResult } from "./graph/commute.js";
import type { MigrationId } from "./migration/types.js";
import type { MigrationOp } from "./ops/types.js";

/** Thrown by `canonicalJson` for a value JSON cannot represent deterministically. */
export class CanonicalJsonError extends Error {
  /** JSONPath-like location of the offending value, e.g. `$.ops[0].spec`. */
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`cannot serialize ${path}: ${reason}`);
    this.name = "CanonicalJsonError";
    this.path = path;
  }
}

/** Why an op could not be applied to a replay state. */
export type ReplayErrorReason =
  | "entity-missing"
  | "entity-exists-different"
  | "field-missing"
  | "field-exists-different"
  | "rename-both-exist"
  | "rename-neither-exists"
  | "alter-shape-mismatch"
  | "dangling-relation"
  | "global-index";

/** Thrown when an op (or the integrity check at the end of a migration) contradicts the state. */
export class ReplayError extends Error {
  readonly op: MigrationOp;
  readonly reason: ReplayErrorReason;
  /** Integrity violations, set when `reason` comes from the end-of-migration check. */
  readonly issues: readonly string[];

  constructor(
    op: MigrationOp,
    reason: ReplayErrorReason,
    detail: string,
    issues: readonly string[] = [],
  ) {
    super(`${op.op}: ${detail}`);
    this.name = "ReplayError";
    this.op = op;
    this.reason = reason;
    this.issues = issues;
  }
}

/** Why a rename hint given to `diff` was rejected. */
export type DiffHintReason = "source-missing" | "target-missing" | "cycle" | "duplicate";

/** Thrown by `diff` when a rename hint contradicts the snapshots or the other hints. */
export class DiffHintError extends Error {
  readonly hint: unknown;
  readonly reason: DiffHintReason;

  constructor(hint: unknown, reason: DiffHintReason, detail: string) {
    super(`invalid rename hint (${reason}): ${detail}`);
    this.name = "DiffHintError";
    this.hint = hint;
    this.reason = reason;
  }
}

/** Thrown when a migration file does not parse or does not match its file name. */
export class MigrationFileError extends ValidationError {
  readonly source: string;

  constructor(source: string, issues: Issue[]) {
    super(issues);
    this.name = "MigrationFileError";
    this.source = source;
    this.message = `invalid migration file ${source}: ${formatIssues(issues)}`;
  }
}

/** Thrown by `slugifyName` when nothing usable is left of a migration name. */
export class InvalidMigrationNameError extends Error {
  readonly input: string;

  constructor(input: string) {
    super(
      `invalid migration name ${JSON.stringify(input)}: use letters or digits, e.g. "add_price"`,
    );
    this.name = "InvalidMigrationNameError";
    this.input = input;
  }
}

/** What is wrong with a set of migration files taken as a graph. */
export type GraphErrorKind = "duplicate" | "unknown-parent" | "cycle";

/**
 * Thrown by `buildGraph`. `ids` lists every offender: the ids that appear twice (`duplicate`), the
 * migrations whose `parent` does not exist (`unknown-parent`) or the migrations on a cycle (`cycle`),
 * sorted.
 */
export class GraphError extends Error {
  readonly kind: GraphErrorKind;
  readonly ids: readonly string[];

  constructor(kind: GraphErrorKind, ids: readonly string[]) {
    super(`migration graph has ${kind}: ${ids.join(", ")}`);
    this.name = "GraphError";
    this.kind = kind;
    this.ids = ids;
  }
}

/** Thrown when a linear chain is required but the graph has several roots or heads. */
export class MultipleHeadsError extends Error {
  readonly heads: readonly string[];

  constructor(heads: readonly string[]) {
    super(
      `migrations have ${heads.length} heads (${heads.join(", ")}); run \`shuri-migrate reconcile\``,
    );
    this.name = "MultipleHeadsError";
    this.heads = heads;
  }
}

/**
 * Thrown by `planReconcile` when two parallel branches cannot be put one after the other safely.
 * `format()` renders the diagnostic a developer reads to fix one of the files.
 */
export class ReconcileConflictError extends Error {
  readonly result: Extract<CommuteResult, { commutes: false }>;
  /** The two branches, as migration ids from the fork point (excluded) to each head. */
  readonly branches: readonly [MigrationId[], MigrationId[]];

  constructor(
    result: Extract<CommuteResult, { commutes: false }>,
    branches: readonly [MigrationId[], MigrationId[]],
  ) {
    super("");
    this.name = "ReconcileConflictError";
    this.result = result;
    this.branches = branches;
    this.message = this.format();
  }

  /** @returns A multi-line description of the branches, the clashing ops and the way out. */
  format(): string {
    return formatConflict(this.result, this.branches);
  }
}

/** Thrown when both parallel branches are already in the frozen ref, so neither may be moved. */
export class FrozenDivergenceError extends Error {
  readonly heads: readonly [MigrationId, MigrationId];

  constructor(heads: readonly [MigrationId, MigrationId]) {
    super(
      `heads ${heads[0]} and ${heads[1]} are both frozen (already in the frozen ref): ` +
        "production has both branches, so write a corrective migration by hand",
    );
    this.name = "FrozenDivergenceError";
    this.heads = heads;
  }
}
