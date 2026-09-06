import {
  all,
  email,
  minLength,
  object,
  required,
  string,
  validate,
  type Issue,
  type Validator,
} from "@shuri/validate";
import type { AdminSetupCredentials } from "./setup-types.js";

/**
 * The shortest password setup accepts. Matches `@shuri/auth`'s own floor, so an account created here
 * can always be signed back in through it.
 */
export const MIN_PASSWORD_LENGTH = 8;

interface SetupBody {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  token?: unknown;
}

/**
 * Runs the value checks only once a value is there, so a missing field reports "is required" and not
 * also "must be a string" — one cause, one issue, which is what a form renders per input.
 * @param validators - The checks to run on a present value.
 * @returns A validator that skips them for an absent one.
 */
const whenPresent =
  (...validators: Validator<unknown>[]): Validator<unknown> =>
  (value, ctx) => {
    if (value === undefined || value === null || value === "") return;
    all(...validators)(value, ctx);
  };

const optionalString = (label: string): Validator<unknown> =>
  whenPresent(string(`"${label}" must be a string`));

const setupValidator: Validator<SetupBody> = object<SetupBody>({
  email: all(
    required('"email" is required'),
    whenPresent(
      string('"email" must be a string'),
      email('"email" must be a valid email'),
    ),
  ),
  password: all(
    required('"password" is required'),
    whenPresent(
      string('"password" must be a string'),
      minLength(
        MIN_PASSWORD_LENGTH,
        `"password" must be at least ${MIN_PASSWORD_LENGTH} characters`,
      ),
    ),
  ),
  name: optionalString("name"),
  token: optionalString("token"),
});

/**
 * Validates a first-account request body against the shape above.
 *
 * Schema-composed rather than hand-checked, like every other body in this repo: the rules are then
 * one object to read, and the issues come back in the shape the admin's form already renders per
 * field.
 * @param body - The parsed request body.
 * @returns The issues found, empty when the body is valid.
 */
export function validateSetupBody(body: unknown): Issue[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return [{ path: "body", message: "must be an object" }];
  }
  return validate(body as SetupBody, setupValidator, "body");
}

/**
 * Reads the credentials off a body `validateSetupBody` accepted.
 *
 * `token` is left behind on purpose: it authorises the request, and has no business on the account
 * being created.
 * @param body - The validated request body.
 * @returns The credentials to create the account with.
 */
export function toCredentials(body: unknown): AdminSetupCredentials {
  const { email: address, password, name } = body as Record<string, string>;
  return { email: address, password, ...(name ? { name } : {}) };
}
