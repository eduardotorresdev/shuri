import {
  authorizeGlobal,
  type AccessContext,
  type GlobalAccessOp,
  type GlobalSchema,
} from "@shuri/core";
import type { PublicGlobal } from "../visibility/public-global.js";
import { deny } from "./principal.js";

/**
 * Wraps a `PublicGlobal` so `read`/`update` are authorized first. A global is one record, so there
 * is no `Where` to honor: `authorizeGlobal` already throws for a rule that answers with one.
 * @param global - The public view to guard.
 * @param schema - The global's schema, for its slug and `access` map.
 * @param base - The request's base context.
 * @returns The guarded view, same interface.
 */
export function guardedGlobal(
  global: PublicGlobal,
  schema: Pick<GlobalSchema, "slug" | "access">,
  base: AccessContext,
): PublicGlobal {
  async function allow(op: GlobalAccessOp, extra: Pick<AccessContext, "data"> = {}) {
    if (!(await authorizeGlobal(schema, op, { ...base, ...extra }))) deny(base.principal);
  }

  return {
    async get() {
      await allow("read");
      return global.get();
    },
    async update(data) {
      await allow("update", { data });
      return global.update(data);
    },
  };
}
