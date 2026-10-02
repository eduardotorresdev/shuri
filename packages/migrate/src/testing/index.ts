// Contract-suite entry (`@shuri/migrate/testing`). vitest is an optional peer dependency.
import { describe } from "vitest";
import { defineCrashContract } from "./contract-crash.js";
import { defineJournalContract } from "./contract-journal.js";
import { defineLockContract } from "./contract-lock.js";
import { defineOpsContract } from "./contract-ops.js";
import type { ContractHarness } from "./types.js";

export * from "./builders.js";
export * from "./conversion-cases.js";
export * from "./schema-from-snapshot.js";
export * from "./fake-driver.js";
export * from "./types.js";

/**
 * Registers the suite every `MigrationDriver` must pass: each op on real data, the lock, the
 * journal, and failure at every step followed by a re-run. Call it from a vitest file.
 * @param name - Driver name, for the suite title.
 * @param h - The harness that builds a fresh driver (and arms failures) for each test.
 */
export function describeMigrationDriverContract(name: string, h: ContractHarness): void {
  describe(`migration driver contract: ${name}`, () => {
    defineOpsContract(name, h);
    defineLockContract(name, h);
    defineJournalContract(name, h);
    defineCrashContract(name, h);
  });
}
