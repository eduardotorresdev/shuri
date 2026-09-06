/**
 * A weak entity tag for `body`, from its length and an FNV-1a hash of its bytes.
 *
 * FNV-1a rather than SHA-256 because an ETag only has to change when the content does, and
 * WebCrypto's digest is async — which would make building the handler asynchronous for a value
 * whose only job is to save a few kilobytes on a reload. Weak (`W/`) since it makes no
 * byte-for-byte promise. Collisions are not a security question here: the bodies being compared are
 * this package's own build output, not anything a request controls.
 * @param body - The asset's bytes.
 * @returns The entity tag, including the surrounding quotes.
 */
export function weakEtag(body: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of body) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `W/"${body.length.toString(36)}-${hash.toString(36)}"`;
}
