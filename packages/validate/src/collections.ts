import type { Validator } from "./types.js";
import { array } from "./validators.js";

export interface ArrayOfOptions {
  /** Minimum number of items. Reported at the array's own path. */
  min?: number;
  /** Message for a shorter array. Defaults to `must have at least <min> item(s)`. */
  minMessage?: string;
}

/**
 * Validates a value of unknown shape (untrusted input: parsed JSON, a query param, ...) as an array,
 * like `array` validates a value already known to be one. Reports `message` and skips item
 * validation if it isn't.
 * @param itemValidator - The validator run against each item, once the value is confirmed to be an array.
 * @param [message] - The issue message reported when the value isn't an array.
 * @param [options] - Extra constraints on the array itself, such as a minimum length.
 * @returns A validator that fails when the value isn't an array, else delegates to `array`.
 */
export function arrayOf<T>(
  itemValidator: Validator<T>,
  message = "must be an array",
  options: ArrayOfOptions = {},
): Validator<unknown> {
  return (value, ctx) => {
    if (!Array.isArray(value)) {
      ctx.addIssue(message);
      return;
    }
    if (options.min !== undefined && value.length < options.min) {
      ctx.addIssue(
        options.minMessage ??
          `must have at least ${options.min} ${options.min === 1 ? "item" : "items"}`,
      );
    }
    array(itemValidator)(value, ctx);
  };
}

export interface RecordOptions {
  /** Validates each key, reported at the key's own path (`ctx.at(key)`). */
  key?: Validator<string>;
}

/**
 * Validates every value of a plain object keyed by arbitrary strings (a dictionary/map), like
 * `object` validates a fixed, known set of keys. For a value of unknown shape (untrusted input),
 * reports `message` and skips item validation if it isn't a plain object.
 * @param valueValidator - The validator run against each value of the object.
 * @param [message] - The issue message reported when the value isn't a plain object.
 * @param [options] - Extra constraints, such as a validator for the keys.
 * @returns A validator that fails when the value isn't a plain object, else validates each entry.
 */
export function record<T>(
  valueValidator: Validator<T>,
  message = "must be an object",
  options: RecordOptions = {},
): Validator<unknown> {
  return (value, ctx) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      ctx.addIssue(message);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const entryCtx = ctx.at(key);
      options.key?.(key, entryCtx);
      valueValidator(item as T, entryCtx);
    }
  };
}
