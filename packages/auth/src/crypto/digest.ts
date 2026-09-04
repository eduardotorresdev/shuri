import { encodeBase64Url } from "./base64url.js";

/**
 * SHA-256 of `value`, as raw bytes.
 * @param value - The text or bytes to digest.
 * @returns The 32-byte digest.
 */
export async function sha256(value: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/**
 * SHA-256 of `value`, base64url encoded — the form session tokens are stored in and the form PKCE
 * requires for `code_challenge`.
 * @param value - The text or bytes to digest.
 * @returns The digest, base64url encoded.
 */
export async function sha256Base64Url(value: string | Uint8Array): Promise<string> {
  return encodeBase64Url(await sha256(value));
}
