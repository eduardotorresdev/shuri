import {
  all,
  matches,
  number,
  object,
  optional,
  refine,
  required,
  string,
  validate,
  type Validator,
} from "@shuri/validate";
import { decodeBase64UrlText, encodeBase64UrlText } from "../crypto/base64url.js";
import { hmacSha256, verifyHmacSha256 } from "../crypto/hmac.js";
import { OAuthTransactionError } from "../errors.js";

/**
 * One in-flight sign-in, carried in a signed cookie rather than a store row.
 *
 * A row would need a cleanup job for every consent screen a user ever abandoned, and would pin the
 * flow to one process in a serverless deployment. A cookie is per-browser and single-use by nature,
 * which is exactly what this is. Field names are short because the whole thing rides in a header.
 */
export interface OidcTransaction {
  /** Provider id this transaction was started for. */
  p: string;
  /** `state`, echoed by the provider. */
  s: string;
  /** `nonce`, echoed inside the id_token. */
  n: string;
  /** PKCE code verifier. */
  v: string;
  /** Expiry, epoch milliseconds. */
  e: number;
  /** Where to send the browser afterwards, already checked by `safeRedirect` when it goes out. */
  r?: string;
}

/** Cookie the transaction rides in; scoped to the OIDC subtree, and gone in ten minutes. */
export const TRANSACTION_COOKIE_NAME = "shuri_oidc_tx";
export const TRANSACTION_TTL_MS = 10 * 60 * 1000;
/** Anything shorter is not a signing key. Enforced at config time, not per request. */
export const MIN_SECRET_LENGTH = 32;

const B64URL = /^[A-Za-z0-9_-]+$/;

const transactionValidator: Validator<OidcTransaction> = object<OidcTransaction>({
  p: all(required('"p" is required'), string('"p" must be a string')),
  s: all(required('"s" is required'), matches(B64URL, '"s" must be base64url')),
  n: all(required('"n" is required'), matches(B64URL, '"n" must be base64url')),
  v: all(required('"v" is required'), matches(B64URL, '"v" must be base64url')),
  e: all(
    number('"e" must be a number'),
    refine<number>((value) => Number.isFinite(value), '"e" must be a number'),
  ),
  r: optional(string('"r" must be a string')),
});

/**
 * Signs a transaction into its cookie value: `<payload>.<hmac>`, both base64url.
 * @param secret - The signing secret.
 * @param transaction - The transaction to carry.
 * @returns The cookie value.
 */
export async function signTransaction(
  secret: string,
  transaction: OidcTransaction,
): Promise<string> {
  const payload = encodeBase64UrlText(JSON.stringify(transaction));
  return `${payload}.${await hmacSha256(secret, payload)}`;
}

/**
 * Reads a transaction back out of its cookie value.
 *
 * **The HMAC is checked before anything is parsed.** Running `JSON.parse` (or a validator) over an
 * unauthenticated payload means the parser's own behavior becomes attacker-reachable; here the
 * signature gates everything downstream.
 *
 * Absent, tampered with, malformed and expired all raise the *same* `OAuthTransactionError` with the
 * same message, so probing the callback teaches nothing about which check failed.
 * @param secret - The signing secret.
 * @param value - The cookie value, or `undefined` when the cookie is absent.
 * @param now - The current time, epoch milliseconds.
 * @returns The verified transaction.
 */
export async function verifyTransaction(
  secret: string,
  value: string | undefined,
  now: number,
): Promise<OidcTransaction> {
  if (!value) throw new OAuthTransactionError();

  const separator = value.indexOf(".");
  if (separator < 1) throw new OAuthTransactionError();

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!(await verifyHmacSha256(secret, payload, signature))) {
    throw new OAuthTransactionError();
  }

  const transaction = parsePayload(payload);
  if (!transaction || transaction.e <= now) throw new OAuthTransactionError();
  return transaction;
}

function parsePayload(payload: string): OidcTransaction | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64UrlText(payload));
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) return undefined;
  const transaction = parsed as OidcTransaction;
  return validate(transaction, transactionValidator).length === 0
    ? transaction
    : undefined;
}
