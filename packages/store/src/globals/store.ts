import type { GlobalSchema, OperationContext } from "@shuri/core";
import type { StoreAdapter } from "../adapter.js";
import type { HookRegistry } from "../hooks/registry.js";
import { globalHooksFor } from "../hooks/resolve.js";
import { runAfterHooks, runBeforeHooks } from "../hooks/run.js";
import type { RecordInput } from "../record.js";
import { assertValidRecord } from "../validate-record.js";

/**
 * Persistence operations scoped to a single global: get and update the one record, each running
 * the global's hooks around the adapter call (see `CollectionStore` for the `context` param). Like
 * `CollectionStore`, this is the complete view: it carries `schema` (`hidden` fields included) and
 * never applies the flag itself.
 */
export interface GlobalStore<R = RecordInput> {
  /** The schema this store was bound to, so the HTTP layer can read visibility metadata off it. */
  readonly schema: GlobalSchema;
  /** Always resolves — to `{}` until the first `update`. `beforeRead` → adapter → `afterRead`. */
  get(context?: OperationContext): Promise<R>;
  /** Reads the pre-image, then `beforeValidate` → partial validation → `beforeChange` → adapter → `afterChange`. */
  update(data: Partial<R>, context?: OperationContext): Promise<R>;
}

/**
 * Binds one global's get/update to `adapter`, running the global's hooks around every call under
 * the same rules as `bindCollection`.
 * @param global - The schema of the global being bound.
 * @param adapter - The persistence adapter backing the global.
 * @param registry - The registry of programmatically registered hooks.
 * @returns The `GlobalStore` for `global`.
 */
export function bindGlobal(
  global: GlobalSchema,
  adapter: StoreAdapter,
  registry: HookRegistry,
): GlobalStore {
  const slug = global.slug;
  const hooks = <N extends Parameters<typeof globalHooksFor>[2]>(name: N) =>
    globalHooksFor(global, registry, name);

  return {
    schema: global,
    async get(context = {}) {
      await runAfterHooks(hooks("beforeRead"), { global: slug, context });
      const doc = (await adapter.findGlobal(global)) ?? {};
      return runBeforeHooks(hooks("afterRead"), { global: slug, context, doc }, "doc");
    },
    async update(input, context = {}) {
      const originalDoc = (await adapter.findGlobal(global)) ?? {};
      const validated = await runBeforeHooks(
        hooks("beforeValidate"),
        { global: slug, context, data: input, originalDoc },
        "data",
      );
      assertValidRecord(global, validated, { partial: true });
      const data = await runBeforeHooks(
        hooks("beforeChange"),
        { global: slug, context, data: validated, originalDoc },
        "data",
      );
      const doc = await adapter.updateGlobal(global, data);
      await runAfterHooks(hooks("afterChange"), {
        global: slug,
        context,
        doc,
        previousDoc: originalDoc,
      });
      return doc;
    },
  };
}
