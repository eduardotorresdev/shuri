import type { ResolvedSchema } from "@shuri/core";
import { PendingMigrationsError, SchemaDriftError } from "../errors/runner.js";
import type { MigrationDriver } from "../driver/types.js";
import { assertTrustworthy, inspect } from "./status.js";
import type { MigrationSet } from "./status.js";

export interface AssertMigratedOptions extends MigrationSet {
  driver: MigrationDriver;
  schema: ResolvedSchema;
}

/**
 * Fails closed: resolves only when the database has exactly the migrations in the files, in a
 * trustworthy state, and the schema in code is what they produce. Takes no lock and changes nothing,
 * so an app can call it at boot (in production, where `migrateUp` is a deploy step).
 * @param o - Files, driver and the schema in code.
 * @throws {MultipleHeadsError} Branches not reconciled.
 * @throws {SchemaDriftError} The schema in code is not what the migrations produce.
 * @throws {UnknownAppliedMigrationError} The journal has migrations the files do not.
 * @throws {ChecksumMismatchError} A migration changed after it ran.
 * @throws {OutOfOrderConflictError} The database's order does not agree with the chain.
 * @throws {PendingMigrationsError} Migrations are pending or interrupted.
 */
export async function assertMigrated(o: AssertMigratedOptions): Promise<void> {
  const inspection = await inspect(o);
  const { schemaDrift, pending, running } = inspection.status;
  if (schemaDrift) throw new SchemaDriftError(schemaDrift);
  assertTrustworthy(inspection);
  if (pending.length > 0 || running.length > 0) {
    throw new PendingMigrationsError(pending, running);
  }
}
