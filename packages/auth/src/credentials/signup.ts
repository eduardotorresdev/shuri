import { EmailAlreadyRegisteredError } from "../errors.js";
import type { PasswordHasher } from "../password/hasher.js";
import type { SessionService } from "../sessions/store.js";
import type { IssuedSession, SessionMetadata } from "../types.js";
import type { UserService } from "../users/service.js";
import type { Credentials } from "./validators.js";

/** Everything the credential flows are built from. Shared by `signup.ts` and `login.ts`. */
export interface CredentialsContext {
  users: UserService;
  sessions: SessionService;
  hasher: PasswordHasher;
}

/**
 * Registers a user and signs them straight in.
 *
 * The 409 for an address already registered is a deliberate, documented leak: closing it means
 * always answering 201 and mailing a "someone tried to register with your address" notice, i.e. the
 * email verification flow this round leaves out.
 * @param context - The user, session and hashing services.
 * @param input - The validated credentials.
 * @param [meta] - Client metadata to record on the session.
 * @returns The newly issued session.
 */
export async function signUp(
  context: CredentialsContext,
  input: Credentials,
  meta: SessionMetadata = {},
): Promise<IssuedSession> {
  const existing = await context.users.findByEmail(input.email);
  if (existing) throw new EmailAlreadyRegisteredError();

  const user = await context.users.create({
    email: input.email,
    name: input.name,
    passwordHash: await context.hasher.hash(input.password),
  });

  return context.sessions.create(user.id, meta);
}
