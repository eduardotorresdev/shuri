import { IssuesApiError } from "@shuri/api";
import {
  all,
  boolean,
  email,
  minLength,
  objectOf,
  required,
  string,
  validate,
  type Issue,
  type Validator,
} from "@shuri/validate";
import { MIN_PASSWORD_LENGTH } from "../auth/setup-validate.js";
import type { AdminUserPatch, NewAdminUser } from "./types.js";

/** A user body that failed validation, carrying the issues the form renders per field. */
export class UserValidationError extends IssuesApiError {
  constructor(issues: Issue[]) {
    super(400, issues);
    this.name = "UserValidationError";
  }
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
    if (value === undefined || value === null) return;
    all(...validators)(value, ctx);
  };

const emailField = whenPresent(
  string('"email" must be a string'),
  email('"email" must be a valid email'),
);
const passwordField = whenPresent(
  string('"password" must be a string'),
  minLength(
    MIN_PASSWORD_LENGTH,
    `"password" must be at least ${MIN_PASSWORD_LENGTH} characters`,
  ),
);
const nameField = whenPresent(string('"name" must be a string'));
const emailVerifiedField = whenPresent(boolean('"emailVerified" must be a boolean'));

/** Refused rather than silently dropped: a body carrying `passwordHash` or `role` is a mistake worth hearing about. */
const options = { unknownKeyMessage: (key: string) => `"${key}" is not a user field` };

const newUserValidator = objectOf<NewAdminUser>(
  {
    email: all(required('"email" is required'), emailField),
    password: passwordField,
    name: nameField,
    emailVerified: emailVerifiedField,
  },
  "must be an object",
  options,
);

const patchValidator = objectOf<AdminUserPatch>(
  {
    email: emailField,
    password: passwordField,
    name: nameField,
    emailVerified: emailVerifiedField,
  },
  "must be an object",
  options,
);

/**
 * Validates a body against `validator`. Issues are rooted at the field (`password`, not
 * `body.password`): the admin's form indexes them by first path segment to put each message under
 * its own input.
 * @param body - The parsed request body.
 * @param validator - The shape to check it against.
 * @returns The body, narrowed.
 * @throws UserValidationError when the body fails the shape.
 */
function parse<T>(body: unknown, validator: Validator<unknown>): T {
  const issues = validate(body, validator);
  if (issues.length > 0) throw new UserValidationError(issues);
  return body as T;
}

/**
 * Validates a create body.
 * @param body - The parsed request body.
 * @returns The new user.
 */
export function parseNewUser(body: unknown): NewAdminUser {
  return parse<NewAdminUser>(body, newUserValidator);
}

/**
 * Validates an update body.
 * @param body - The parsed request body.
 * @returns The patch.
 */
export function parseUserPatch(body: unknown): AdminUserPatch {
  return parse<AdminUserPatch>(body, patchValidator);
}
