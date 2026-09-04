import { randomToken } from "../crypto/random.js";
import { AuthenticationFailedError } from "../errors.js";
import type { IssuedSession, SessionMetadata } from "../types.js";
import type { CredentialsContext } from "./signup.js";
import type { Credentials } from "./validators.js";

/**
 * A hash to verify against when there is no real one, so an unknown email costs exactly what a wrong
 * password costs.
 *
 * Without it, an unknown address answers in about a millisecond and a wrong password in a few
 * hundred — a user-enumeration oracle anyone can read over the open internet with a stopwatch. The
 * dummy is derived at runtime from the *current* parameters rather than hardcoded, because a
 * hardcoded constant stops matching the real cost the day someone raises the iteration count. It is
 * computed once per process and shared (single-flight), so the first login pays for it and no other
 * one does.
 * @param context - The credential services, for the hasher.
 * @returns A hash in the hasher's current format, over a value nobody can guess.
 */
function dummyHash(context: CredentialsContext): Promise<string> {
  cache.set(
    context.hasher,
    cache.get(context.hasher) ?? context.hasher.hash(randomToken()),
  );
  return cache.get(context.hasher) as Promise<string>;
}

const cache = new WeakMap<object, Promise<string>>();

/**
 * Signs a user in with an email and a password.
 *
 * Unknown email, account without a password (OIDC-only) and wrong password all end in the *same*
 * `AuthenticationFailedError`, after the *same* amount of work: every path runs one key derivation,
 * and the result is only consulted at the end. Returning early on the OIDC-only case would leak
 * "this address exists and signs in with Google", which is worse than plain existence.
 *
 * A successful login whose stored hash is weaker than the current parameters is rewritten in place,
 * which is how a table migrates without a flag day.
 * @param context - The user, session and hashing services.
 * @param input - The validated credentials.
 * @param [meta] - Client metadata to record on the session.
 * @returns The newly issued session.
 */
export async function signIn(
  context: CredentialsContext,
  input: Credentials,
  meta: SessionMetadata = {},
): Promise<IssuedSession> {
  const user = await context.users.findByEmail(input.email);
  const storedHash = user?.["passwordHash"];
  const stored = typeof storedHash === "string" ? storedHash : await dummyHash(context);
  const matched = await context.hasher.verify(input.password, stored);

  if (!user || typeof storedHash !== "string" || !matched) {
    throw new AuthenticationFailedError();
  }

  if (context.hasher.needsRehash?.(storedHash)) {
    await context.users.update(user.id, {
      passwordHash: await context.hasher.hash(input.password),
    });
  }

  return context.sessions.create(user.id, meta);
}
