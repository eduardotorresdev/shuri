import { SCOPE_PATTERN } from "@shuri/core";
import {
  all,
  arrayOf,
  matches,
  object,
  oneOf,
  optional,
  record,
  refine,
  string,
  validate,
  type Validator,
} from "@shuri/validate";
import type { ClientsConfig } from "../config.js";
import { ClientsConfigError, UnknownRoleError } from "../errors.js";

const scopePatternValidator: Validator<unknown> = all(
  string("a scope pattern must be a string"),
  matches(
    SCOPE_PATTERN,
    'a scope pattern must be "*", "<slug>:*", "*:<op>" or "<slug>:<op>"',
  ),
);

const clientsConfigValidator: Validator<ClientsConfig> = object<ClientsConfig>({
  roles: record(
    arrayOf(scopePatternValidator, "a role must be a list of scope patterns"),
    '"roles" must be an object of role -> scope patterns',
  ),
  tokenTtlMs: optional(
    refine(
      (value) => Number.isInteger(value) && value > 0,
      '"tokenTtlMs" must be a positive integer',
    ),
  ),
});

/**
 * Validates `AuthConfig.clients` at boot, through `@shuri/validate` like every other config here.
 * @param config - The clients config, or `undefined` when the host declared none.
 * @returns Nothing; throws `ClientsConfigError` when malformed.
 */
export function assertValidClientsConfig(config: ClientsConfig | undefined): void {
  if (config === undefined) return;
  const issues = validate(config, clientsConfigValidator, "auth.clients");
  if (issues.length > 0) throw new ClientsConfigError(issues);
}

/**
 * Validates the roles given to a client against the ones the config declares.
 * @param roles - The role names to check.
 * @param known - The declared role names.
 * @returns Nothing; throws `UnknownRoleError` for a name not in `known`.
 */
export function assertKnownRoles(
  roles: readonly string[],
  known: readonly string[],
): void {
  const issues = validate(
    [...roles],
    arrayOf(
      oneOf(
        known,
        (role) => `unknown role "${role}"; declared roles: ${known.join(", ")}`,
      ),
    ),
    "roles",
  );
  if (issues.length > 0) throw new UnknownRoleError(issues);
}
