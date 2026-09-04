import { encodeBase64Url } from "./base64url.js";

/** Bytes of entropy behind every session token, `state` and PKCE verifier this package issues. */
export const TOKEN_BYTES = 32;

/**
 * Draws `length` cryptographically random bytes from the platform CSPRNG.
 * @param length - How many bytes to draw.
 * @returns The random bytes.
 */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Draws a random opaque token: 32 bytes of entropy as 43 base64url characters. Opaque and
 * unstructured on purpose — a session token proves nothing by itself, it is only ever a key into a
 * row the server owns, which is what makes revocation real.
 * @param [length] - How many random bytes to draw.
 * @returns The token, base64url encoded.
 */
export function randomToken(length = TOKEN_BYTES): string {
  return encodeBase64Url(randomBytes(length));
}
