import { encodeBase64Url, decodeBase64Url } from "../crypto/base64url.js";
import { timingSafeEqual } from "../crypto/equal.js";
import { randomBytes } from "../crypto/random.js";
import { formatPbkdf2Hash, parsePbkdf2Hash, type Pbkdf2Hash } from "./encoding.js";
import type { PasswordHasher } from "./hasher.js";

export const PBKDF2_ALGORITHM = "pbkdf2-sha256";

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Raising it later doesn't invalidate existing hashes. */
export const DEFAULT_ITERATIONS = 600_000;
const SALT_BYTES = 16;
/** 32 bytes: exactly SHA-256's output. Deriving more costs the defender per login and the attacker nothing. */
const KEY_LENGTH = 32;

export interface Pbkdf2HasherOptions {
  /** Iterations for newly written hashes. Existing hashes keep verifying with their own count. */
  iterations?: number;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
  keyLength: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    keyLength * 8,
  );
  return encodeBase64Url(new Uint8Array(bits));
}

/**
 * The default `PasswordHasher`: PBKDF2-HMAC-SHA256 over a fresh 16-byte salt, in the self-describing
 * format `encoding.ts` defines.
 *
 * `verify` takes every parameter from the stored hash rather than from `options`, so a tenant that
 * raises `iterations` keeps every existing password working; `needsRehash` then reports the weaker
 * rows so a successful login can quietly rewrite them.
 * @param [options] - Options controlling newly written hashes, e.g. `iterations`.
 * @returns A `PasswordHasher` backed by WebCrypto's PBKDF2.
 */
export function createPbkdf2Hasher(options: Pbkdf2HasherOptions = {}): PasswordHasher {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;

  return {
    id: PBKDF2_ALGORITHM,

    async hash(password) {
      const salt = randomBytes(SALT_BYTES);
      const digest = await derive(password, salt, iterations, KEY_LENGTH);
      const parsed: Pbkdf2Hash = {
        iterations,
        keyLength: KEY_LENGTH,
        salt: encodeBase64Url(salt),
        digest,
      };
      return formatPbkdf2Hash(PBKDF2_ALGORITHM, parsed);
    },

    async verify(password, stored) {
      const parsed = parsePbkdf2Hash(stored);
      if (!parsed) return false;

      const digest = await derive(
        password,
        decodeBase64Url(parsed.salt),
        parsed.iterations,
        parsed.keyLength,
      );
      return timingSafeEqual(digest, parsed.digest);
    },

    needsRehash(stored) {
      const parsed = parsePbkdf2Hash(stored);
      return !parsed || parsed.iterations < iterations || parsed.keyLength < KEY_LENGTH;
    },
  };
}
