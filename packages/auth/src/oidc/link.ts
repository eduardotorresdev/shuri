import type { CollectionStore, RecordInput, StoreRecord } from "@shuri/store";
import { AccountLinkRefusedError, MissingEmailClaimError } from "../errors.js";
import type { Now } from "../types.js";
import type { UserService } from "../users/service.js";
import type { IdTokenClaims, ResolvedProvider } from "./types.js";

export interface LinkContext {
  accounts: CollectionStore<RecordInput>;
  users: UserService;
  now: Now;
}

/**
 * Resolves the external identity in `claims` to a local user, creating the user and/or the link when
 * needed. In this exact order:
 *
 * 1. An existing `_accounts` row for `(provider, sub)` wins outright. The email is not consulted:
 *    `sub` is the stable identity, and an address the user changed at the provider must not orphan
 *    their account.
 * 2. A **verified** email matching an existing local user whose own email is **also already
 *    verified** links to it. Requiring both sides is what closes federated-merge pre-hijacking: this
 *    package has no email-verification flow, so `POST /auth/signup` lets anyone plant a
 *    `user@example.com` row ahead of its real owner, with `emailVerified: false`. If the incoming
 *    claim's verification alone were enough, that planted row — complete with an attacker-known
 *    password — would be exactly what the real owner's later "Sign in with Google" links to and gets
 *    signed into. Only a local account that itself already carries a verified email (today, one
 *    created by a prior OIDC sign-in) is eligible to receive an automatic merge.
 * 3. An unverified claim, an unverified existing user, or a provider with linking turned off are all
 *    refused with the same generic 403. This is also the pre-emptive account takeover case: nothing
 *    here reveals whether the account exists, or which side of the check failed.
 * 4. No email claim at all is a 400 asking for the scope; there is nothing to match or create on.
 * 5. Otherwise, a new user and its link.
 * @param context - The accounts collection, user service and clock.
 * @param provider - The resolved provider the identity came from.
 * @param claims - The validated claims.
 * @returns The local user this identity signs in as.
 */
export async function resolveOidcUser(
  context: LinkContext,
  provider: ResolvedProvider,
  claims: IdTokenClaims,
): Promise<StoreRecord<RecordInput>> {
  const linked = await findLinkedUser(context, provider.id, claims.sub);
  if (linked) return linked;

  const email = typeof claims.email === "string" ? claims.email : undefined;
  if (!email) throw new MissingEmailClaimError();

  const emailVerified = claims.email_verified === true;
  const existing = await context.users.findByEmail(email);

  if (existing) {
    const existingVerified = existing["emailVerified"] === true;
    if (!emailVerified || !existingVerified || !provider.allowLinkingByVerifiedEmail) {
      throw new AccountLinkRefusedError();
    }
    await link(context, provider.id, claims.sub, existing.id);
    return existing;
  }

  const created = await context.users.create({
    email,
    name: typeof claims.name === "string" ? claims.name : undefined,
    emailVerified,
  });
  await link(context, provider.id, claims.sub, created.id);
  return created;
}

async function findLinkedUser(
  context: LinkContext,
  providerId: string,
  subject: string,
): Promise<StoreRecord<RecordInput> | undefined> {
  const [account] = await context.accounts.findMany({
    where: {
      provider: { op: "eq", value: providerId },
      subject: { op: "eq", value: subject },
    },
    limit: 1,
  });
  if (!account) return undefined;

  return context.users.findById(account["user"] as string);
}

async function link(
  context: LinkContext,
  providerId: string,
  subject: string,
  userId: string,
): Promise<void> {
  await context.accounts.insert({
    provider: providerId,
    subject,
    user: userId,
    createdAt: context.now(),
  });
}
