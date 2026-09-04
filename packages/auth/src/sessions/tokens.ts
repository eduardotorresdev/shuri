import { sha256Base64Url } from "../crypto/digest.js";
import { randomToken } from "../crypto/random.js";

/** A freshly minted session token and the digest that goes to the store. */
export interface SessionToken {
  /** The plaintext token, handed to the client once and never stored. */
  token: string;
  /** `base64url(SHA-256(token))` — 43 characters, which is what `_sessions.tokenHash` declares. */
  tokenHash: string;
}

/**
 * Hashes a session token for lookup and storage.
 *
 * Plain SHA-256: no salt, no stretching. A stretched digest here would buy nothing (32 uniform
 * random bytes have no dictionary to attack) and would cost a KDF run on *every authenticated
 * request*, which is the one place latency is felt.
 * @param token - The plaintext session token.
 * @returns The stored form of `token`.
 */
export function hashSessionToken(token: string): Promise<string> {
  return sha256Base64Url(token);
}

/**
 * Mints a session token: 32 bytes from the platform CSPRNG, plus its digest.
 * @returns The plaintext token and the digest to store.
 */
export async function issueSessionToken(): Promise<SessionToken> {
  const token = randomToken();
  return { token, tokenHash: await hashSessionToken(token) };
}
