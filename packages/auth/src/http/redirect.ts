export interface RedirectPolicy {
  /** Where to send the browser when the requested target isn't allowed (or wasn't given). */
  fallback: string;
  /** Absolute origins a redirect may target, e.g. a separate SPA host. Empty by default. */
  allowedOrigins?: readonly string[];
}

/**
 * Whether `value` carries a control character. Checked by code point rather than by regex: a
 * control character in a `Location` can smuggle a header break past a naive serializer.
 * @param value - The candidate redirect target.
 * @returns Whether it contains any control character.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Resolves where a login flow may send the browser.
 *
 * A callback that reflects an attacker-chosen `Location` is a credential-phishing primitive: the
 * victim really did sign in, and lands on a page the attacker controls with the flow looking normal.
 * So `target` is honored only if it is a same-site path — starting with exactly one `/`, never `//`
 * or `/\\` (both of which browsers read as protocol-relative, i.e. another origin) — or an absolute
 * URL whose origin the host listed. Anything else, control characters included, falls back.
 * @param target - The requested redirect target, typically `?redirectTo=`.
 * @param policy - The fallback and the absolute origins allowed.
 * @returns A redirect target safe to put in a `Location` header.
 */
export function safeRedirect(
  target: string | null | undefined,
  policy: RedirectPolicy,
): string {
  if (!target || hasControlCharacter(target)) return policy.fallback;

  if (target.startsWith("/")) {
    return target.startsWith("//") || target.startsWith("/\\") ? policy.fallback : target;
  }

  const allowed = policy.allowedOrigins ?? [];
  if (allowed.length === 0) return policy.fallback;

  try {
    const url = new URL(target);
    return allowed.includes(url.origin) ? url.toString() : policy.fallback;
  } catch {
    return policy.fallback;
  }
}
