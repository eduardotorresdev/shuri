import { redactRecord, type OperationContext } from "@shuri/core";
import type { GlobalStore, RecordInput } from "@shuri/store";
import { assertWritableRecord } from "./guards.js";

/** The two operations REST exposes for a global, redacted and guarded like `PublicCollection`. */
export interface PublicGlobal {
  get(): Promise<RecordInput>;
  update(data: Partial<RecordInput>): Promise<RecordInput>;
}

/**
 * Wraps a `GlobalStore` in the HTTP-facing view of it: `hidden` fields never leave, and a body
 * writing one is refused. Every store call is made with `context`, like `publicCollection`.
 * @param global - The full global store to narrow.
 * @param context - The request's operation context, forwarded to every store call.
 * @returns The public view of `global`.
 */
export function publicGlobal(
  global: GlobalStore<RecordInput>,
  context: OperationContext,
): PublicGlobal {
  const { schema } = global;

  return {
    async get() {
      return redactRecord(schema, await global.get(context));
    },
    async update(data) {
      assertWritableRecord(schema, data);
      return redactRecord(schema, await global.update(data, context));
    },
  };
}
