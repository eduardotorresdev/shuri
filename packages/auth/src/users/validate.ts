import type { RecordInput } from "@shuri/store";
import {
  boolean,
  object,
  optional,
  refine,
  validate,
  type Validator,
} from "@shuri/validate";
import { emailRule, nameRule, passwordRule } from "../credentials/validators.js";
import { InvalidUserError } from "../errors.js";

/** What creating a user through administration accepts. `password` is optional: an OIDC-only user has none. */
export interface NewUser {
  email: string;
  name?: string;
  password?: string;
  emailVerified?: boolean;
}

/** What updating one accepts. Every field is optional — a patch carrying only a name is a name change. */
export type UserPatch = Partial<NewUser>;

interface RawUser {
  email?: unknown;
  name?: unknown;
  password?: unknown;
  emailVerified?: unknown;
  passwordHash?: unknown;
}

/**
 * Refuses a body that writes the stored hash directly.
 *
 * Ignoring it silently would be worse than refusing: the field is `hidden`, so a caller sending
 * `passwordHash` gets no hint that the one thing they meant to change is the one thing that didn't.
 * The rest of the body is whitelisted by construction — `admin.ts` copies field by field — so this
 * is the only key worth naming.
 */
const noPasswordHash: Validator<unknown> = refine(
  (value) => value === undefined,
  '"passwordHash" cannot be written directly; send "password" instead',
);

const emailVerifiedRule = boolean('"emailVerified" must be a boolean');

const newUserValidator: Validator<RawUser> = object<RawUser>({
  email: emailRule,
  name: optional(nameRule),
  password: optional(passwordRule),
  emailVerified: optional(emailVerifiedRule),
  passwordHash: noPasswordHash,
});

const userPatchValidator: Validator<RawUser> = object<RawUser>({
  email: optional(emailRule),
  name: optional(nameRule),
  password: optional(passwordRule),
  emailVerified: optional(emailVerifiedRule),
  passwordHash: noPasswordHash,
});

/**
 * Validates a new user's body, through the same field rules signup is validated with — one password
 * policy, one email shape, whichever door the user comes in by.
 *
 * Issues are rooted at the **field**, not at `body` the way the signup route roots them: these are
 * read by an admin form, which indexes issues by their first path segment to put each message under
 * its own input. `body.password` would land under a field called "body", i.e. nowhere.
 * @param body - The body to validate.
 * @returns The validated user.
 */
export function parseNewUser(body: RecordInput): NewUser {
  const issues = validate(body, newUserValidator);
  if (issues.length > 0) throw new InvalidUserError(issues);
  return body as unknown as NewUser;
}

/**
 * Validates an update's body: the same rules, with every field optional.
 * @param body - The body to validate.
 * @returns The validated patch.
 */
export function parseUserPatch(body: RecordInput): UserPatch {
  const issues = validate(body, userPatchValidator);
  if (issues.length > 0) throw new InvalidUserError(issues);
  return body as unknown as UserPatch;
}
