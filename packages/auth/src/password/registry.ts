import { hashAlgorithm } from "./encoding.js";
import type { PasswordHasher } from "./hasher.js";

export interface HasherRegistryConfig {
  /** Every hasher able to verify a hash present in the table, keyed by nothing — routed by their own `id`. */
  hashers: readonly PasswordHasher[];
  /** The algorithm id new hashes are written with. Must be one of `hashers`. */
  preferred: string;
}

/**
 * Composes several hashers into one, dispatching `verify` on the algorithm id encoded in the stored
 * hash and always writing new ones with `preferred`.
 *
 * This is what migrates a live table off PBKDF2 without a flag day: add the new hasher, point
 * `preferred` at it, and every login rewrites one more row (`needsRehash` reports every hash not
 * written by `preferred`).
 * @param config - The hashers to dispatch across and the id new hashes are written with.
 * @returns A `PasswordHasher` routing by algorithm id.
 */
export function createHasherRegistry(config: HasherRegistryConfig): PasswordHasher {
  const byId = new Map(config.hashers.map((hasher) => [hasher.id, hasher]));
  const preferred = byId.get(config.preferred);
  if (!preferred) {
    throw new Error(`Unknown preferred password hasher "${config.preferred}"`);
  }

  return {
    id: preferred.id,
    hash: (password) => preferred.hash(password),

    async verify(password, stored) {
      const hasher = byId.get(hashAlgorithm(stored) ?? "");
      return hasher ? hasher.verify(password, stored) : false;
    },

    needsRehash(stored) {
      const algorithm = hashAlgorithm(stored);
      if (algorithm !== preferred.id) return true;
      return preferred.needsRehash?.(stored) ?? false;
    },
  };
}
