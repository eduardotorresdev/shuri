import { arrayOf, func, objectOf, optional, type Validator } from "@shuri/validate";

/**
 * Validates the shape of a declared `hooks` map: an object whose keys are `names` and whose values
 * are arrays of functions. What a hook *does* can only be checked when it runs (see `@shuri/store`'s
 * `hooks/run.ts`); this validates what can be checked at declaration time, like `accessValidator`.
 * @param names - The hook names the schema kind accepts (`COLLECTION_HOOK_NAMES`/`GLOBAL_HOOK_NAMES`).
 * @returns A validator for an optional `hooks` map.
 */
export function hooksValidator(names: readonly string[]): Validator<unknown> {
  const fields: Record<string, Validator<unknown>> = {};
  for (const name of names) {
    fields[name] = optional(
      arrayOf(
        func(`"${name}" hooks must be functions`),
        `"${name}" must be an array of hooks`,
      ),
    );
  }
  return optional(
    objectOf(fields, '"hooks" must be an object', {
      unknownKeyMessage: (key) => `"${key}" is not a hook (${names.join(", ")})`,
    }),
  );
}
