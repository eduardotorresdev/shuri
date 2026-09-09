import {
  ApiError,
  IssuesApiError,
  MethodNotAllowedError,
  readJsonBody,
  toErrorResponse,
  type FallingHandler,
} from "@shuri/api";
import type { AdminSetup } from "../../shared/schema.js";
import type { AdminSetupOptions, AdminSetupSource } from "./setup-types.js";
import { toCredentials, validateSetupBody } from "./setup-validate.js";

/** Header the one-time setup token may be sent in, as an alternative to the body field. */
const TOKEN_HEADER = "x-shuri-setup-token";

/** Setup was attempted after the app already had an account. */
export class SetupAlreadyDoneError extends ApiError {
  constructor() {
    super(409, "This app already has an account; setup is closed");
    this.name = "SetupAlreadyDoneError";
  }
}

/** The one-time token was missing or wrong. Deliberately the same answer for both. */
export class SetupTokenError extends ApiError {
  constructor() {
    super(403, "Invalid setup token");
    this.name = "SetupTokenError";
  }
}

/** A first-account body that failed validation, carrying the issues the form renders per field. */
export class SetupValidationError extends IssuesApiError {
  constructor(issues: ConstructorParameters<typeof IssuesApiError>[1]) {
    super(400, issues);
    this.name = "SetupValidationError";
  }
}

/** Setup resolved to what the schema advertises and what the handler enforces. */
export interface ResolvedAdminSetup {
  advertised: AdminSetup;
  source: AdminSetupSource;
  required(): Promise<boolean>;
}

/**
 * Resolves the host's setup options, applying the defaults.
 * @param options - The host's setup options.
 * @param basePath - The admin's mount path, which the default setup path hangs off.
 * @returns The resolved setup.
 */
export function resolveAdminSetup(
  options: AdminSetupOptions,
  basePath: string,
): ResolvedAdminSetup {
  return {
    advertised: {
      path: options.path ?? `${basePath}/setup`,
      tokenRequired: options.token !== undefined,
    },
    source: options.source,
    required: () => options.source.required(),
  };
}

/**
 * Compares two strings without leaking, through timing, how much of the first matched.
 *
 * `===` on strings returns as soon as it finds a difference, so an attacker measuring the response
 * can recover a token one character at a time. Length is compared first and does leak, which is
 * fine: a token's length is not the secret.
 * @param a - The expected token.
 * @param b - The token the request carried.
 * @returns Whether the two are equal.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Serves the first-account route, and declines every other request.
 *
 * Everything this route does is guarded by `source.required()`, and it is asked **twice**: once to
 * refuse early, and again inside a lock immediately before creating the account. The second check is
 * the one that matters — without it, two requests arriving together both see "no account yet" and
 * both create an administrator.
 *
 * The lock is a promise chain, so it serialises attempts **within this process**. Two processes
 * racing is beyond what this can see; a deployment that needs that guarantee wants a unique
 * constraint on the users table, or the token.
 * @param setup - The resolved setup.
 * @param [token] - The one-time token the request must carry, when the host set one.
 * @returns A handler answering the setup route, `undefined` for anything else.
 */
export function createAdminSetupHandler(
  setup: ResolvedAdminSetup,
  token?: string,
): FallingHandler {
  const path = setup.advertised.path;
  // Serialises attempts: each waits for the previous to finish before re-checking `required()`.
  let queue: Promise<unknown> = Promise.resolve();

  async function attempt(request: Request): Promise<Response> {
    if (request.method !== "POST") throw new MethodNotAllowedError(request.method);
    if (!(await setup.required())) throw new SetupAlreadyDoneError();

    const body = await readJsonBody(request);
    const issues = validateSetupBody(body);
    if (issues.length > 0) throw new SetupValidationError(issues);

    if (token !== undefined) {
      const supplied =
        request.headers.get(TOKEN_HEADER) ?? (body as { token?: unknown }).token;
      if (typeof supplied !== "string" || !constantTimeEquals(token, supplied)) {
        throw new SetupTokenError();
      }
    }

    // Re-checked inside the lock: the request that got here first may have just created the account.
    if (!(await setup.required())) throw new SetupAlreadyDoneError();
    return setup.source.create(toCredentials(body), request);
  }

  return async function handleRequest(request) {
    if (new URL(request.url).pathname !== path) return undefined;

    const run = queue.then(
      () => attempt(request).catch(toErrorResponse),
      () => attempt(request).catch(toErrorResponse),
    );
    // The queue must not reject, or every later attempt would be rejected with it.
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
