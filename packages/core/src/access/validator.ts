import { objectOf, optional, refine, type Validator } from "@shuri/validate";
import type { AccessOp } from "./types.js";

/**
 * Validates the shape of a declared `access` map: an object whose keys are `ops` and whose values
 * are booleans or functions. What a function *returns* can only be checked when it runs (see
 * `policy.ts`); this validates what can be checked at declaration time.
 * @param ops - The operations the schema kind accepts (`COLLECTION_ACCESS_OPS`/`GLOBAL_ACCESS_OPS`).
 * @returns A validator for an optional `access` map.
 */
export function accessValidator(ops: readonly AccessOp[]): Validator<unknown> {
  const fields: Record<string, Validator<unknown>> = {};
  for (const op of ops) {
    fields[op] = optional(
      refine(
        (value) => typeof value === "boolean" || typeof value === "function",
        `"${op}" must be a boolean or a function`,
      ),
    );
  }
  return optional(
    objectOf(fields, '"access" must be an object', {
      unknownKeyMessage: (key) =>
        `"${key}" is not an access operation (${ops.join(", ")})`,
    }),
  );
}
