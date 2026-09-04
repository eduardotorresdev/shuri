import type { Validator } from "./types.js";

/**
 * Reports an issue when the value isn't a string. Narrows `unknown`, so downstream combinators in an
 * `all(...)` chain still see `unknown` — compose with `refine` for the checks that follow.
 * @param [message] - The issue message reported when the value isn't a string.
 * @returns A validator that fails when the value isn't a string.
 */
export function string(message = "must be a string"): Validator<unknown> {
  return (value, ctx) => {
    if (typeof value !== "string") ctx.addIssue(message);
  };
}

/**
 * Reports an issue when the value isn't a number, `NaN` included — `NaN` passes `typeof` but is
 * never a meaningful field value.
 * @param [message] - The issue message reported when the value isn't a number.
 * @returns A validator that fails when the value isn't a number.
 */
export function number(message = "must be a number"): Validator<unknown> {
  return (value, ctx) => {
    if (typeof value !== "number" || Number.isNaN(value)) ctx.addIssue(message);
  };
}

/**
 * Reports an issue when the value isn't a boolean.
 * @param [message] - The issue message reported when the value isn't a boolean.
 * @returns A validator that fails when the value isn't a boolean.
 */
export function boolean(message = "must be a boolean"): Validator<unknown> {
  return (value, ctx) => {
    if (typeof value !== "boolean") ctx.addIssue(message);
  };
}

/**
 * Reports an issue when a string is shorter than `min`. A non-string value is left to `string()`,
 * so composing the two reports one issue rather than two for the same cause.
 * @param min - The minimum accepted length.
 * @param [message] - The issue message reported when the string is too short.
 * @returns A validator that fails when the value is a string shorter than `min`.
 */
export function minLength(min: number, message?: string): Validator<unknown> {
  const fallback = `must be at least ${min} characters`;
  return (value, ctx) => {
    if (typeof value === "string" && value.length < min) {
      ctx.addIssue(message ?? fallback);
    }
  };
}

/**
 * Reports an issue when a string is longer than `max`. A non-string value is left to `string()`, for
 * the same reason as `minLength`.
 * @param max - The maximum accepted length.
 * @param [message] - The issue message reported when the string is too long.
 * @returns A validator that fails when the value is a string longer than `max`.
 */
export function maxLength(max: number, message?: string): Validator<unknown> {
  const fallback = `must be at most ${max} characters`;
  return (value, ctx) => {
    if (typeof value === "string" && value.length > max) {
      ctx.addIssue(message ?? fallback);
    }
  };
}

/**
 * Reports an issue when a string doesn't match `pattern`. A non-string value is left to `string()`.
 *
 * `pattern.test` is called on a fresh `lastIndex` every time: a `/g` or `/y` regex carries state
 * between calls, which would make the same value pass and fail alternately.
 * @param pattern - The regular expression the string must match.
 * @param message - The issue message reported when the string doesn't match.
 * @returns A validator that fails when the value is a string not matching `pattern`.
 */
export function matches(pattern: RegExp, message: string): Validator<unknown> {
  return (value, ctx) => {
    if (typeof value !== "string") return;
    pattern.lastIndex = 0;
    if (!pattern.test(value)) ctx.addIssue(message);
  };
}
