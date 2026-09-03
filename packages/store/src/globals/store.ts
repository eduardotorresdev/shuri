import type { GlobalSchema } from "@shuri/core";
import type { StoreAdapter } from "../adapter.js";
import type { RecordInput } from "../record.js";
import { assertValidRecord } from "../validate-record.js";

/** Persistence operations scoped to a single global: get and update the one record. */
export interface GlobalStore<R = RecordInput> {
  /** Always resolves — to `{}` until the first `update`. */
  get(): Promise<R>;
  update(data: Partial<R>): Promise<R>;
}

export function bindGlobal(global: GlobalSchema, adapter: StoreAdapter): GlobalStore {
  return {
    async get() {
      const record = await adapter.findGlobal(global);
      return record ?? {};
    },
    async update(data) {
      assertValidRecord(global, data, { partial: true });
      return adapter.updateGlobal(global, data);
    },
  };
}
