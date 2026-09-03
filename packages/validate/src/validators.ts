import { createContext } from "./context.js";
import { ValidationError } from "./errors.js";
import type { Issue, Validator } from "./types.js";

export function validate<T>(value: T, validator: Validator<T>, rootPath = ""): Issue[] {
  const { context, issues } = createContext(rootPath);
  validator(value, context);
  return issues;
}

export function assertValid<T>(value: T, validator: Validator<T>, rootPath = ""): void {
  const issues = validate(value, validator, rootPath);
  if (issues.length > 0) {
    throw new ValidationError(issues);
  }
}

/** Reports an issue when `value` is `undefined`, `null` or an empty string. */
export function required(message = '"value" is required'): Validator<unknown> {
  return (value, ctx) => {
    if (value === undefined || value === null || value === "") {
      ctx.addIssue(message);
    }
  };
}

export function refine<T>(check: (value: T) => boolean, message: string | ((value: T) => string)): Validator<T> {
  return (value, ctx) => {
    if (!check(value)) {
      ctx.addIssue(typeof message === "function" ? message(value) : message);
    }
  };
}

/** Skips `validator` when the value is `undefined`, so callers don't have to guard optional fields by hand. */
export function optional<T>(validator: Validator<T>): Validator<T | undefined> {
  return (value, ctx) => {
    if (value !== undefined) validator(value, ctx);
  };
}

/** Reports an issue when the value isn't one of `allowed` (by `===`). */
export function oneOf<T>(allowed: readonly T[], message?: string | ((value: T) => string)): Validator<T> {
  return (value, ctx) => {
    if (!allowed.includes(value)) {
      const fallback = `must be one of ${allowed.join(", ")}`;
      ctx.addIssue(typeof message === "function" ? message(value) : (message ?? fallback));
    }
  };
}

/** Runs every validator against the same value and context, collecting all of their issues. */
export function all<T>(...validators: Validator<T>[]): Validator<T> {
  return (value, ctx) => {
    for (const validator of validators) validator(value, ctx);
  };
}

/** Validates each declared field of an object at its own path segment. */
export function object<T extends object>(fields: { [K in keyof T]?: Validator<T[K]> }): Validator<T> {
  return (value, ctx) => {
    for (const key of Object.keys(fields) as (keyof T)[]) {
      const fieldValidator = fields[key];
      if (fieldValidator) fieldValidator(value[key], ctx.at(String(key)));
    }
  };
}

/**
 * Like `array`, but for a value of unknown shape (untrusted input: parsed JSON, a query param, ...)
 * instead of one already known to be an array. Reports `message` and skips item validation if it isn't.
 */
export function arrayOf<T>(itemValidator: Validator<T>, message = "must be an array"): Validator<unknown> {
  return (value, ctx) => {
    if (!Array.isArray(value)) {
      ctx.addIssue(message);
      return;
    }
    array(itemValidator)(value, ctx);
  };
}

/**
 * Validates every value of a plain object keyed by arbitrary strings (a dictionary/map), unlike
 * `object`, which validates a fixed, known set of keys. For a value of unknown shape (untrusted
 * input), reports `message` and skips item validation if it isn't a plain object.
 */
export function record<T>(valueValidator: Validator<T>, message = "must be an object"): Validator<unknown> {
  return (value, ctx) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      ctx.addIssue(message);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      valueValidator(item as T, ctx.at(key));
    }
  };
}

/** Reports an issue when the array has no items. */
export function nonEmpty(message = "must not be empty"): Validator<unknown[]> {
  return (values, ctx) => {
    if (values.length === 0) ctx.addIssue(message);
  };
}

/** Validates each item of an array at a numeric path segment. */
export function array<T>(itemValidator: Validator<T>): Validator<T[]> {
  return (values, ctx) => {
    values.forEach((item, index) => itemValidator(item, ctx.at(index)));
  };
}

export interface KeyedArrayOptions<T> {
  /**
   * Key used to detect duplicates, separately from the path key. Return `undefined` to exempt
   * an item (e.g. one still missing the field the key is derived from) from duplicate checks.
   * Defaults to the path key.
   */
  dedupeKey?: (item: T, index: number) => string | undefined;
  /** When set, reports this message (at the item's own path) for every item after the first sharing a dedupe key. */
  duplicateMessage?: (key: string, item: T) => string;
}

/** Like `array`, but paths items by a caller-provided key instead of their index. */
export function keyedArray<T>(
  keyOf: (item: T, index: number) => string,
  itemValidator: Validator<T>,
  options: KeyedArrayOptions<T> = {},
): Validator<T[]> {
  return (values, ctx) => {
    const seen = new Set<string>();
    values.forEach((item, index) => {
      const itemCtx = ctx.at(keyOf(item, index));
      const dedupeKey = (options.dedupeKey ?? keyOf)(item, index);

      if (dedupeKey !== undefined) {
        if (options.duplicateMessage && seen.has(dedupeKey)) {
          itemCtx.addIssue(options.duplicateMessage(dedupeKey, item));
        }
        seen.add(dedupeKey);
      }

      itemValidator(item, itemCtx);
    });
  };
}

/** Reports an issue at the collection's own path for every item sharing a key. */
export function unique<T>(keyOf: (item: T) => string | undefined, message: (key: string) => string): Validator<T[]> {
  return (values, ctx) => {
    const seen = new Set<string>();
    for (const item of values) {
      const key = keyOf(item);
      if (key === undefined) continue;
      if (seen.has(key)) ctx.addIssue(message(key));
      seen.add(key);
    }
  };
}
