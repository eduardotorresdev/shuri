import { redactRecord } from "@shuri/core";
import type { GlobalStore, RecordInput } from "@shuri/store";
import { assertWritableRecord } from "./guards.js";

/** The two operations REST exposes for a global, redacted and guarded like `PublicCollection`. */
export interface PublicGlobal {
  get(): Promise<RecordInput>;
  update(data: Partial<RecordInput>): Promise<RecordInput>;
}

/**
 * Wraps a `GlobalStore` in the HTTP-facing view of it: `hidden` fields never leave, and a body
 * writing one is refused.
 * @param global - The full global store to narrow.
 * @returns The public view of `global`.
 */
export function publicGlobal(global: GlobalStore<RecordInput>): PublicGlobal {
  const { schema } = global;

  return {
    async get() {
      return redactRecord(schema, await global.get());
    },
    async update(data) {
      assertWritableRecord(schema, data);
      return redactRecord(schema, await global.update(data));
    },
  };
}
