import { encodeBase64Url } from "./base64url.js";
import { timingSafeEqual } from "./equal.js";

function importKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * HMAC-SHA256 of `message` under `secret`, base64url encoded. Signs the short-lived OIDC transaction
 * cookie, which is what lets a payload the browser carried be trusted on the way back.
 * @param secret - The signing secret.
 * @param message - The exact string being signed.
 * @returns The signature, base64url encoded.
 */
export async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

/**
 * Recomputes the signature of `message` and compares it to `signature` in constant time.
 * @param secret - The signing secret.
 * @param message - The exact string that was signed.
 * @param signature - The signature to check, base64url encoded.
 * @returns Whether `signature` is the signature of `message` under `secret`.
 */
export async function verifyHmacSha256(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  return timingSafeEqual(await hmacSha256(secret, message), signature);
}
