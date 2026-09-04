import {
  all,
  matches,
  number,
  object,
  refine,
  required,
  string,
  validate,
  type Validator,
} from "@shuri/validate";

/** A parsed PBKDF2 hash: everything `verify` needs, read back off the stored string itself. */
export interface Pbkdf2Hash {
  iterations: number;
  keyLength: number;
  salt: string;
  digest: string;
}

/**
 * Bounds on the iteration count read out of a stored hash. The upper one is not a style choice: a
 * corrupted (or attacker-written) row claiming `i=2000000000` would pin a core for minutes on every
 * login attempt against it — a denial of service handed out for free.
 */
export const MIN_ITERATIONS = 1_000;
export const MAX_ITERATIONS = 10_000_000;

const B64URL = /^[A-Za-z0-9_-]+$/;

const integerBetween = (min: number, max: number, message: string): Validator<number> =>
  all(
    number(message) as Validator<number>,
    refine<number>(
      (value) => Number.isInteger(value) && value >= min && value <= max,
      message,
    ),
  );

const hashValidator: Validator<Pbkdf2Hash> = object<Pbkdf2Hash>({
  iterations: integerBetween(
    MIN_ITERATIONS,
    MAX_ITERATIONS,
    `iterations must be an integer between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}`,
  ),
  keyLength: integerBetween(16, 64, "dk must be an integer between 16 and 64"),
  salt: all(
    required("salt is required"),
    string("salt must be a string"),
    matches(B64URL, "salt must be base64url"),
  ),
  digest: all(
    required("digest is required"),
    string("digest must be a string"),
    matches(B64URL, "digest must be base64url"),
  ),
});

/**
 * Formats a hash in the self-describing PHC-like layout
 * `$pbkdf2-sha256$i=<iterations>,dk=<keyLength>$<salt>$<digest>`.
 *
 * Self-describing is the point: `verify` reads the parameters back out of the stored string, never
 * out of the current config, so raising the iteration count next year leaves every existing hash
 * verifiable and lets `needsRehash` upgrade rows silently as their owners log in.
 * @param algorithm - The algorithm id, e.g. "pbkdf2-sha256".
 * @param hash - The parameters, salt and digest to encode.
 * @returns The encoded hash string.
 */
export function formatPbkdf2Hash(algorithm: string, hash: Pbkdf2Hash): string {
  return `$${algorithm}$i=${hash.iterations},dk=${hash.keyLength}$${hash.salt}$${hash.digest}`;
}

/**
 * Reads the algorithm id off a stored hash, so a registry can route it to the hasher that produced
 * it. Returns `undefined` for anything not shaped like one of ours.
 * @param stored - The stored hash string.
 * @returns The algorithm id, or `undefined` when `stored` isn't parseable.
 */
export function hashAlgorithm(stored: string): string | undefined {
  const parts = stored.split("$");
  return parts.length === 5 && parts[0] === "" ? parts[1] : undefined;
}

/**
 * Parses a stored hash. Returns `undefined` — never throws — for anything malformed or out of
 * bounds, which is what lets `verify` answer `false` for a corrupted row instead of 500ing.
 * @param stored - The stored hash string.
 * @returns The parsed hash, or `undefined` when `stored` isn't a valid one.
 */
export function parsePbkdf2Hash(stored: string): Pbkdf2Hash | undefined {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "") return undefined;

  const [, , params, salt, digest] = parts;
  const entries = new Map(
    params.split(",").map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)] as const;
    }),
  );

  const hash: Pbkdf2Hash = {
    iterations: Number(entries.get("i")),
    keyLength: Number(entries.get("dk")),
    salt,
    digest,
  };
  return validate(hash, hashValidator).length === 0 ? hash : undefined;
}
