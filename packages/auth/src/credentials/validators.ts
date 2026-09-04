import type { RecordInput } from "@shuri/store";
import {
  all,
  matches,
  maxLength,
  minLength,
  object,
  optional,
  required,
  string,
  validate,
  type Validator,
} from "@shuri/validate";
import { InvalidCredentialsError } from "../errors.js";

/** What signup and login read off a request body. */
export interface Credentials {
  email: string;
  password: string;
  name?: string;
}

/** OWASP's floor. Length is the only strength rule enforced here; composition rules are known not to help. */
export const MIN_PASSWORD_LENGTH = 8;
/**
 * A cap, not a policy: the password is fed to a KDF, so an unbounded one is a request that burns CPU
 * for as long as the sender cares to make it.
 */
export const MAX_PASSWORD_LENGTH = 256;

// Deliberately loose: the only address worth calling valid is one that was delivered to, and a
// stricter pattern only ever rejects real addresses.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RawCredentials {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

const credentialsValidator: Validator<RawCredentials> = object<RawCredentials>({
  email: all(
    required('"email" is required'),
    string('"email" must be a string'),
    matches(EMAIL, '"email" must be a valid email address'),
  ),
  password: all(
    required('"password" is required'),
    string('"password" must be a string'),
    minLength(
      MIN_PASSWORD_LENGTH,
      `"password" must be at least ${MIN_PASSWORD_LENGTH} characters`,
    ),
    maxLength(
      MAX_PASSWORD_LENGTH,
      `"password" must be at most ${MAX_PASSWORD_LENGTH} characters`,
    ),
  ),
  name: optional(
    all(string('"name" must be a string'), maxLength(200, '"name" is too long')),
  ),
});

/**
 * Validates a signup/login body against the credentials shape, through `@shuri/validate` — the same
 * source of validation the schema layer uses, rather than hand-rolled `typeof` checks.
 * @param body - The parsed request body.
 * @returns The validated credentials.
 */
export function parseCredentials(body: RecordInput): Credentials {
  const issues = validate(body, credentialsValidator, "body");
  if (issues.length > 0) throw new InvalidCredentialsError(issues);
  return body as unknown as Credentials;
}
