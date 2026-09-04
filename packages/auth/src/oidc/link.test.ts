import type { CollectionStore, RecordInput } from "@shuri/store";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountLinkRefusedError, MissingEmailClaimError } from "../errors.js";
import { createAuthStore, createClock } from "../test-support.js";
import { createUserService, type UserService } from "../users/service.js";
import { oidcProvider } from "./config.js";
import { resolveOidcUser, type LinkContext } from "./link.js";
import { baseClaims, ISSUER } from "./test-support.js";

const provider = oidcProvider({
  id: "acme",
  issuer: ISSUER,
  clientId: "client-123",
  redirectUri: "https://app.example.com/cb",
});

let context: LinkContext;
let users: UserService;
let accounts: CollectionStore<RecordInput>;
const clock = createClock();

beforeEach(() => {
  const store = createAuthStore();
  users = createUserService(
    store.collection("users") as CollectionStore<RecordInput>,
    clock,
  );
  accounts = store.collection("_accounts") as CollectionStore<RecordInput>;
  context = { users, accounts, now: clock };
});

const claims = () => ({ ...baseClaims(clock()), nonce: "n" });

describe("resolveOidcUser", () => {
  it("creates the user and the link on a first sign-in", async () => {
    const user = await resolveOidcUser(context, provider, claims());

    expect(user).toMatchObject({ email: "ada@example.com", emailVerified: true });
    expect(await accounts.findMany()).toEqual([
      expect.objectContaining({ provider: "acme", subject: "subject-1", user: user.id }),
    ]);
  });

  it("reuses the link on the next sign-in, without creating a second account row", async () => {
    const first = await resolveOidcUser(context, provider, claims());
    const second = await resolveOidcUser(context, provider, claims());

    expect(second.id).toBe(first.id);
    expect(await accounts.findMany()).toHaveLength(1);
  });

  it("follows the subject, not the email, when the address changed at the provider", async () => {
    const first = await resolveOidcUser(context, provider, claims());
    const renamed = await resolveOidcUser(context, provider, {
      ...claims(),
      email: "ada.lovelace@example.com",
    });

    expect(renamed.id).toBe(first.id);
  });

  it("links a verified email to an existing user whose own email is also verified", async () => {
    const existing = await users.create({ email: "ada@example.com", emailVerified: true });
    const resolved = await resolveOidcUser(context, provider, claims());

    expect(resolved.id).toBe(existing.id);
    expect(await accounts.findMany()).toHaveLength(1);
  });

  it("refuses an unverified email matching an existing user: pre-emptive takeover", async () => {
    await users.create({ email: "ada@example.com", emailVerified: true });

    await expect(
      resolveOidcUser(context, provider, { ...claims(), email_verified: false }),
    ).rejects.toThrow(AccountLinkRefusedError);
    expect(await accounts.findMany()).toEqual([]);
  });

  it("says nothing about the account existing when it refuses", async () => {
    await users.create({ email: "ada@example.com", emailVerified: true });

    await expect(
      resolveOidcUser(context, provider, { ...claims(), email_verified: false }),
    ).rejects.toThrow("This identity cannot be used to sign in");
  });

  it("refuses linking into an existing user whose own email isn't verified, even when the incoming claim is: closes federated-merge pre-hijacking", async () => {
    // Exactly what an open, unverified `/auth/signup` produces: an attacker plants this row for the
    // victim's address ahead of time, password known only to the attacker.
    const planted = await users.create({
      email: "ada@example.com",
      passwordHash: "attacker-controlled-hash",
    });

    await expect(resolveOidcUser(context, provider, claims())).rejects.toThrow(
      AccountLinkRefusedError,
    );
    expect(await accounts.findMany()).toEqual([]);
    // The planted row is left exactly as it was: not linked, not signed into, password untouched.
    expect(await users.findById(planted.id)).toMatchObject({
      passwordHash: "attacker-controlled-hash",
    });
  });

  it("refuses linking by email when the provider turned that off", async () => {
    await users.create({ email: "ada@example.com" });
    const strict = oidcProvider({
      id: "acme",
      issuer: ISSUER,
      clientId: "client-123",
      redirectUri: "https://app.example.com/cb",
      allowLinkingByVerifiedEmail: false,
    });

    await expect(resolveOidcUser(context, strict, claims())).rejects.toThrow(
      AccountLinkRefusedError,
    );
  });

  it("creates an unverified user when the address is new", async () => {
    const user = await resolveOidcUser(context, provider, {
      ...claims(),
      email_verified: false,
    });
    expect(user).toMatchObject({ email: "ada@example.com", emailVerified: false });
  });

  it("asks for the email scope when the claims carry no address", async () => {
    const { email: _email, ...withoutEmail } = claims();
    await expect(resolveOidcUser(context, provider, withoutEmail)).rejects.toThrow(
      MissingEmailClaimError,
    );
  });

  it("creates an OIDC-only user with no password hash at all", async () => {
    const user = await resolveOidcUser(context, provider, claims());
    expect(user["passwordHash"]).toBeUndefined();
  });
});
