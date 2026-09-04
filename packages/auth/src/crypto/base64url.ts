/**
 * Encodes bytes as base64url (RFC 4648 §5): the URL- and cookie-safe alphabet, unpadded. Every
 * token, salt, digest and signature in this package travels in this encoding, so nothing needs
 * percent-escaping on the way out.
 * @param bytes - The bytes to encode.
 * @returns The unpadded base64url representation of `bytes`.
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Decodes an unpadded base64url string back to bytes. Throws `TypeError` (from `atob`) for input
 * that isn't valid base64 — every caller here treats that as "not a value we issued".
 * @param value - The base64url string to decode.
 * @returns The decoded bytes.
 */
export function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Encodes a UTF-8 string as base64url, the form JWT segments and this package's transaction
 * payloads travel in.
 * @param value - The string to encode.
 * @returns The unpadded base64url representation of `value` UTF-8 encoded.
 */
export function encodeBase64UrlText(value: string): string {
  return encodeBase64Url(new TextEncoder().encode(value));
}

/**
 * Decodes an unpadded base64url string as UTF-8 text.
 * @param value - The base64url string to decode.
 * @returns The decoded text.
 */
export function decodeBase64UrlText(value: string): string {
  return new TextDecoder().decode(decodeBase64Url(value));
}
