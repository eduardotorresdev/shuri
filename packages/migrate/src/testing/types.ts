import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import type { OpName } from "../ops/types.js";
import type { Migratable } from "../driver/types.js";

/** A stored row as the contract sees it. */
export type ContractRow = Record<string, unknown> & { id: string };

/** Structural subset of `StoreAdapter` the contract needs (migrate does not depend on `@shuri/store`). */
export interface ContractAdapter extends Migratable {
  insert(c: CollectionSchema, data: Record<string, unknown>): Promise<ContractRow>;
  findMany(c: CollectionSchema): Promise<ContractRow[]>;
  findGlobal(g: GlobalSchema): Promise<Record<string, unknown> | undefined>;
  updateGlobal(
    g: GlobalSchema,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export interface ContractWorld {
  adapter: ContractAdapter;
  /**
   * Arms a one-shot failure: the next `execute` throws right after step `afterStep` (the ops with
   * effect `applied`, counted from 1) and before the next one. `0` fails before the first op;
   * a value equal to the number of steps fails after the last op and before the journal says `done`.
   * Whatever the driver's atomicity says must survive the failure is what the contract checks.
   */
  injectFailure(afterStep: number): void;
  cleanup(): Promise<void>;
}

export interface ContractHarness {
  /**
   * Ops the driver does not implement yet. The contract skips the cases that need them (and swaps
   * them out of the crash chain), so a driver can land in stages. Leave it empty for a full driver.
   */
  unsupportedOps?: readonly OpName[];
  make(): Promise<ContractWorld>;
}
