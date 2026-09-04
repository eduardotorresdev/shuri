import type { CollectionStore, RecordInput } from "@shuri/store";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthenticationFailedError, EmailAlreadyRegisteredError } from "../errors.js";
import { createPbkdf2Hasher } from "../password/pbkdf2.js";
import { createSessionService } from "../sessions/store.js";
import { createAuthStore, createClock, createTestHasher } from "../test-support.js";
import { createUserService, type UserService } from "../users/service.js";
import { signIn } from "./login.js";
import { signUp, type CredentialsContext } from "./signup.js";

let context: CredentialsContext;
let users: UserService;

function build(hasher = createTestHasher()): CredentialsContext {
  const store = createAuthStore();
  const clock = createClock();
  users = createUserService(
    store.collection("users") as CollectionStore<RecordInput>,
    clock,
  );
  return {
    users,
    hasher,
    sessions: createSessionService({
      sessions: store.collection("_sessions") as CollectionStore<RecordInput>,
      users,
      now: clock,
      ttlMs: 1000,
      renewWithinMs: 0,
    }),
  };
}

beforeEach(() => {
  context = build();
});

describe("signUp", () => {
  it("creates the user, hashes the password and issues a session", async () => {
    const issued = await signUp(context, {
      email: "Ada@Example.com",
      password: "correct-horse",
      name: "Ada",
    });

    expect(issued.user.email).toBe("ada@example.com");
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = await users.findByEmail("ada@example.com");
    expect(stored?.["passwordHash"]).not.toBe("correct-horse");
    expect(
      await context.hasher.verify("correct-horse", String(stored?.["passwordHash"])),
    ).toBe(true);
  });

  it("refuses an email already registered", async () => {
    await signUp(context, { email: "a@b.com", password: "correct-horse" });
    await expect(
      signUp(context, { email: "A@B.com", password: "correct-horse" }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });
});

describe("signIn", () => {
  beforeEach(async () => {
    await signUp(context, { email: "a@b.com", password: "correct-horse" });
  });

  it("issues a session for the right password", async () => {
    const issued = await signIn(context, { email: "a@b.com", password: "correct-horse" });
    expect(issued.user.email).toBe("a@b.com");
  });

  it("gives the same error for an unknown email, a wrong password and an OIDC-only user", async () => {
    const oidcOnly = await users.create({ email: "oidc@b.com" });
    expect(oidcOnly["passwordHash"]).toBeUndefined();

    const failures = await Promise.all(
      [
        { email: "nobody@b.com", password: "correct-horse" },
        { email: "a@b.com", password: "wrong-password" },
        { email: "oidc@b.com", password: "correct-horse" },
      ].map((input) => signIn(context, input).catch((error: unknown) => error)),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(AuthenticationFailedError);
      expect((failure as AuthenticationFailedError).status).toBe(401);
      expect((failure as AuthenticationFailedError).message).toBe(
        "Invalid email or password",
      );
    }
  });

  it("burns a key derivation even for an unknown email, so timing tells nothing", async () => {
    const hasher = createTestHasher();
    let derivations = 0;
    const counted = {
      ...hasher,
      verify: (password: string, stored: string) => {
        derivations += 1;
        return hasher.verify(password, stored);
      },
    };
    const counting = build(counted);
    await signUp(counting, { email: "a@b.com", password: "correct-horse" });

    await signIn(counting, { email: "nobody@b.com", password: "x".repeat(12) }).catch(
      () => undefined,
    );
    expect(derivations).toBe(1);
  });

  it("rewrites a hash written with weaker parameters, on the way through", async () => {
    const weak = createPbkdf2Hasher({ iterations: 1_000 });
    const strong = createPbkdf2Hasher({ iterations: 2_000 });
    const upgrading = build(strong);

    const user = await users.create({
      email: "old@b.com",
      passwordHash: await weak.hash("correct-horse"),
    });

    await signIn(upgrading, { email: "old@b.com", password: "correct-horse" });

    const rewritten = await users.findById(user.id);
    expect(strong.needsRehash?.(String(rewritten?.["passwordHash"]))).toBe(false);
    expect(
      await strong.verify("correct-horse", String(rewritten?.["passwordHash"])),
    ).toBe(true);
  });
});
