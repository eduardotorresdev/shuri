import { sha256Base64Url } from "../crypto/digest.js";
import { randomToken } from "../crypto/random.js";

export interface PkcePair {
  /** The secret kept in the transaction cookie and replayed at the token endpoint. */
  verifier: string;
  /** `base64url(SHA-256(verifier))`, sent in the authorization request. */
  challenge: string;
}

/**
 * Mints a PKCE pair (RFC 7636, `S256`).
 *
 * PKCE is what makes an intercepted authorization code useless: the code can only be redeemed by
 * whoever holds the verifier behind the challenge, which never leaves this server's cookie.
 * @returns The verifier and its challenge.
 */
export async function createPkcePair(): Promise<PkcePair> {
  // 43 base64url characters, comfortably inside RFC 7636's 43..128 range.
  const verifier = randomToken();
  return { verifier, challenge: await sha256Base64Url(verifier) };
}
