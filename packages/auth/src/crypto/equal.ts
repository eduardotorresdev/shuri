/**
 * Compares two strings without leaking, through timing, how far they agree. Used wherever a
 * comparison decides authentication (`state`, `nonce`, digests): a plain `===` returns as soon as it
 * finds a difference, which is enough to recover a secret one character at a time.
 *
 * Length is compared up front, since it can't be hidden by a fixed-time loop anyway; only the
 * contents are compared in constant time.
 * @param a - The first string.
 * @param b - The second string.
 * @returns Whether both strings are equal.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
