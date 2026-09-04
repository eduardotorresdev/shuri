/**
 * The port every password hashing algorithm plugs into. PBKDF2 is the only KDF WebCrypto offers, and
 * it is what ships here — but a host running on Node can plug scrypt or argon2 in without this
 * package (or any call site) changing, which is the whole reason this is a port and not a function.
 */
export interface PasswordHasher {
  /** Algorithm identifier, matching the first field of the hashes this hasher produces. */
  readonly id: string;
  hash(password: string): Promise<string>;
  /**
   * Checks `password` against a stored hash. Never throws: a hash this hasher can't parse is a
   * `false`, so a corrupted row fails a login instead of failing the request.
   */
  verify(password: string, stored: string): Promise<boolean>;
  /** Whether `stored` was produced with weaker parameters than the current ones, so login can rewrite it. */
  needsRehash?(stored: string): boolean;
}
