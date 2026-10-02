import type { ResolvedSchema } from "@shuri/core";
import {
  ChecksumMismatchError,
  UnknownAppliedMigrationError,
  type OutOfOrderConflictError,
} from "../errors/runner.js";
import type { AppliedMigration, MigrationDriver } from "../driver/types.js";
import { buildGraph, linearChain } from "../graph/graph.js";
import { checksumOf } from "../migration/checksum.js";
import type { MigrationFile, MigrationId } from "../migration/types.js";
import { diff } from "../ops/diff.js";
import { replay } from "../ops/replay.js";
import type { MigrationOp } from "../ops/types.js";
import { snapshotOf } from "../schema/snapshot.js";
import { findOrderConflict } from "./order.js";
import { realOrderOf } from "./plan.js";

export interface MigrationSet {
  /** Already validated (see `parseMigration`). */
  files: readonly MigrationFile[];
}

export interface MigrationStatus {
  /** The linear chain, in application order. */
  chain: MigrationId[];
  applied: AppliedMigration[];
  /** In the chain and not in the journal, in chain order. */
  pending: MigrationId[];
  /** Journal entries that started and did not finish (a crash). */
  running: MigrationId[];
  /** In the journal and not in the files. */
  unknownApplied: MigrationId[];
  /** In the journal with a checksum different from the file's. */
  checksumMismatch: MigrationId[];
  /** Pending migrations that come before an applied one in the chain. */
  outOfOrder: MigrationId[];
  /** The real order does not end in the chain's schema (see `OutOfOrderConflictError`). */
  outOfOrderConflict: boolean;
  /** What the schema in code needs on top of the migrations; `null` when none, or no schema given. */
  schemaDrift: MigrationOp[] | null;
}

export interface StatusInput extends MigrationSet {
  driver: MigrationDriver;
  schema?: ResolvedSchema;
}

/** The chain with the checksum of each of its migrations. */
export interface ChainInfo {
  chain: MigrationFile[];
  checksums: Map<MigrationId, string>;
}

/**
 * @param files - Migration files.
 * @returns The linear chain and every checksum.
 * @throws {GraphError} If the files are not a valid graph.
 * @throws {MultipleHeadsError} If branches are not reconciled yet.
 */
export async function chainInfoOf(files: readonly MigrationFile[]): Promise<ChainInfo> {
  const chain = linearChain(buildGraph(files));
  const sums = await Promise.all(chain.map((file) => checksumOf(file)));
  return { chain, checksums: new Map(chain.map((file, i) => [file.id, sums[i]])) };
}

/**
 * @param chain - The chain.
 * @param schema - The schema in code.
 * @returns The ops the code's schema needs on top of the migrations, or `null` when there are none.
 * @throws {ReplayError} If the chain does not replay.
 */
export function driftOf(
  chain: readonly MigrationFile[],
  schema: ResolvedSchema,
): MigrationOp[] | null {
  const { ops } = diff(replay(chain).snapshot, snapshotOf(schema));
  return ops.length > 0 ? ops : null;
}

/** What `migrationStatus` computes, plus what `migrateUp` needs next. */
export interface Inspection extends ChainInfo {
  status: MigrationStatus;
  /** The order the database really has: journal first, then pending in chain order. */
  order: MigrationFile[];
  conflict: OutOfOrderConflictError | undefined;
}

/**
 * Reads the journal and compares it with the files.
 * @param i - Files, driver and (optionally) the schema in code.
 * @returns The status and the data derived from it.
 */
export async function inspect(i: StatusInput): Promise<Inspection> {
  const info = await chainInfoOf(i.files);
  const { chain, checksums } = info;
  const applied = await i.driver.applied();
  const position = new Map(chain.map((file, index) => [file.id, index]));
  const journaled = new Set(applied.map((entry) => entry.id));
  const lastApplied = Math.max(
    -1,
    ...applied.map((entry) => position.get(entry.id) ?? -1),
  );
  const pending = chain.filter((file) => !journaled.has(file.id)).map((file) => file.id);
  const order = realOrderOf(chain, applied);
  const conflict = findOrderConflict(chain, order);
  const status: MigrationStatus = {
    chain: chain.map((file) => file.id),
    applied,
    pending,
    running: applied.filter((e) => e.status === "running").map((e) => e.id),
    unknownApplied: applied.filter((e) => !position.has(e.id)).map((e) => e.id),
    checksumMismatch: applied
      .filter((e) => position.has(e.id) && checksums.get(e.id) !== e.checksum)
      .map((e) => e.id),
    outOfOrder: pending.filter((id) => (position.get(id) as number) < lastApplied),
    outOfOrderConflict: conflict !== undefined,
    schemaDrift: i.schema ? driftOf(chain, i.schema) : null,
  };
  return { ...info, status, order, conflict };
}

/**
 * Throws for a journal that cannot be trusted: migrations the files do not have, migrations edited
 * after they ran, or a real order that does not agree with the chain.
 * @param inspection - A reading of the journal.
 * @throws {UnknownAppliedMigrationError} Journal entries without a file.
 * @throws {ChecksumMismatchError} Edited migrations.
 * @throws {OutOfOrderConflictError} Incompatible order.
 */
export function assertTrustworthy(inspection: Inspection): void {
  const { unknownApplied, checksumMismatch } = inspection.status;
  if (unknownApplied.length > 0) throw new UnknownAppliedMigrationError(unknownApplied);
  if (checksumMismatch.length > 0) throw new ChecksumMismatchError(checksumMismatch);
  if (inspection.conflict) throw inspection.conflict;
}

/**
 * Compares the migration files with a database, without changing either.
 * @param i - Files, driver and (optionally) the schema in code.
 * @returns The status. Problems are reported in it, not thrown (except an invalid graph or chain).
 * @throws {GraphError} If the files are not a valid graph.
 * @throws {MultipleHeadsError} If branches are not reconciled yet.
 */
export async function migrationStatus(i: StatusInput): Promise<MigrationStatus> {
  return (await inspect(i)).status;
}
