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

/**
 * Reports an issue when `value` is `undefined`, `null` or an empty string.
 * @param [message] - The issue message reported when the value is missing.
 * @returns A validator that fails when the value is missing.
 */
export function required(message = '"value" is required'): Validator<unknown> {
  return (value, ctx) => {
    if (value === undefined || value === null || value === "") {
      ctx.addIssue(message);
    }
  };
}

export function refine<T>(
  check: (value: T) => boolean,
  message: string | ((value: T) => string),
): Validator<T> {
  return (value, ctx) => {
    if (!check(value)) {
      ctx.addIssue(typeof message === "function" ? message(value) : message);
    }
  };
}

/**
 * Skips `validator` when the value is `undefined`, so callers don't have to guard optional fields by hand.
 * @param validator - The validator to run once the value is present.
 * @returns A validator that skips `validator` for `undefined` values.
 */
export function optional<T>(validator: Validator<T>): Validator<T | undefined> {
  return (value, ctx) => {
    if (value !== undefined) validator(value, ctx);
  };
}

/**
 * Accepts `null` and otherwise delegates to `validator`, for properties that are explicitly nullable
 * (as opposed to `optional`, which accepts `undefined`).
 * @param validator - The validator to run once the value is not `null`.
 * @returns A validator that skips `validator` for `null` values.
 */
export function nullable<T>(validator: Validator<T>): Validator<T | null> {
  return (value, ctx) => {
    if (value !== null) validator(value, ctx);
  };
}

/**
 * Reports an issue when the value isn't one of `allowed` (by `===`).
 * @param allowed - The set of values the input must be one of.
 * @param [message] - The issue message, or a function producing one from the value.
 * @returns A validator that fails when the value isn't in `allowed`.
 */
export function oneOf<T>(
  allowed: readonly T[],
  message?: string | ((value: T) => string),
): Validator<T> {
  return (value, ctx) => {
    if (!allowed.includes(value)) {
      const fallback = `must be one of ${allowed.join(", ")}`;
      ctx.addIssue(
        typeof message === "function" ? message(value) : (message ?? fallback),
      );
    }
  };
}

/**
 * Runs every validator against the same value and context, collecting all of their issues.
 * @param validators - The validators to run, in order, against the same value.
 * @returns A validator that runs all of `validators`.
 */
export function all<T>(...validators: Validator<T>[]): Validator<T> {
  return (value, ctx) => {
    for (const validator of validators) validator(value, ctx);
  };
}

/**
 * Validates each declared field of an object at its own path segment.
 * @param fields - The validator for each declared field, keyed by field name.
 * @returns A validator that runs each field's validator at its own path segment.
 */
export function object<T extends object>(fields: {
  [K in keyof T]?: Validator<T[K]>;
}): Validator<T> {
  return (value, ctx) => {
    for (const key of Object.keys(fields) as (keyof T)[]) {
      const fieldValidator = fields[key];
      if (fieldValidator) fieldValidator(value[key], ctx.at(String(key)));
    }
  };
}

export interface ObjectOfOptions {
  /** When set, reports this message (at the key's own path) for every key not declared in `fields`. */
  unknownKeyMessage?: (key: string) => string;
}

/**
 * Validates a value of unknown shape (untrusted input, a config literal, ...) as a plain object with
 * the declared `fields`, like `object` validates a value already known to be one — the same pairing
 * `arrayOf` forms with `array`. Reports `message` and skips field validation if it isn't a plain
 * object; with `unknownKeyMessage`, also reports every key `fields` doesn't declare.
 * @param fields - The validator for each declared field, keyed by field name.
 * @param [message] - The issue message reported when the value isn't a plain object.
 * @param [options] - Options controlling how undeclared keys are reported.
 * @returns A validator that fails when the value isn't a plain object, else delegates to `object`.
 */
export function objectOf<T extends object>(
  fields: { [K in keyof T]?: Validator<T[K]> },
  message = "must be an object",
  options: ObjectOfOptions = {},
): Validator<unknown> {
  return (value, ctx) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      ctx.addIssue(message);
      return;
    }
    if (options.unknownKeyMessage) {
      for (const key of Object.keys(value)) {
        if (!(key in fields)) ctx.at(key).addIssue(options.unknownKeyMessage(key));
      }
    }
    object<T>(fields)(value as T, ctx);
  };
}

/**
 * Reports an issue when the array has no items.
 * @param [message] - The issue message reported when the array is empty.
 * @returns A validator that fails when the array has no items.
 */
export function nonEmpty(message = "must not be empty"): Validator<unknown[]> {
  return (values, ctx) => {
    if (values.length === 0) ctx.addIssue(message);
  };
}

/**
 * Validates each item of an array at a numeric path segment.
 * @param itemValidator - The validator run against each item.
 * @returns A validator that runs `itemValidator` against each item, at its index.
 */
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

/**
 * Paths items by a caller-provided key, like `array` paths them by index.
 * @param keyOf - Derives the path key for an item.
 * @param itemValidator - The validator run against each item.
 * @param [options] - Options controlling duplicate-key detection and reporting.
 * @returns A validator that runs `itemValidator` against each item, at its derived key.
 */
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

/**
 * Reports an issue at the collection's own path for every item sharing a key.
 * @param keyOf - Derives the dedupe key for an item; `undefined` exempts it.
 * @param message - Produces the issue message reported for a duplicate key.
 * @returns A validator that fails once per item after the first sharing a key.
 */
export function unique<T>(
  keyOf: (item: T) => string | undefined,
  message: (key: string) => string,
): Validator<T[]> {
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
