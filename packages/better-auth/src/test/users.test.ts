import type { CollectionSchema } from "@shuri/core";
import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { beforeEach, describe, expect, it } from "vitest";
import { EmailAlreadyRegisteredError, UserNotFoundError } from "../errors.js";
import { betterAuthPlugin } from "../plugin.js";

const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [{ type: "text", name: "title", required: true }],
  },
] as const satisfies readonly CollectionSchema[];

const PASSWORD = "correct horse battery staple";

function createApp() {
  const ba = betterAuthPlugin({
    options: {
      baseURL: "http://localhost",
      secret: "test-secret-at-least-32-characters-long",
      emailAndPassword: { enabled: true },
    },
  });
  const app = create({ collections, adapter: createMemoryAdapter(), plugins: [ba] });
  return { app, ba, users: ba.sessionSource.users };
}

const json = (path: string, body: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Signs in over better-auth's own route, which is the only proof that a password an operator set
 * is one better-auth accepts.
 * @param app - The app to sign in against.
 * @param email - The address.
 * @param password - The password to try.
 * @returns The sign-in response.
 */
function signIn(
  app: ReturnType<typeof createApp>["app"],
  email: string,
  password: string,
) {
  return app.handler(json("/api/auth/sign-in/email", { email, password }));
}

describe("user administration over better-auth", () => {
  let app: ReturnType<typeof createApp>["app"];
  let users: ReturnType<typeof createApp>["users"];

  beforeEach(() => {
    ({ app, users } = createApp());
  });

  it("creates an account whose password better-auth's own sign-in accepts", async () => {
    const created = await users.create({ email: "ada@example.com", password: PASSWORD });

    expect(created).toMatchObject({ email: "ada@example.com", emailVerified: false });
    expect(JSON.stringify(created)).not.toContain(PASSWORD);
    expect((await signIn(app, "ada@example.com", PASSWORD)).status).toBe(200);
  });

  it("creates an account with no password, which then signs in through a provider only", async () => {
    const created = await users.create({ email: "ada@example.com", name: "Ada" });

    expect(created.name).toBe("Ada");
    expect(
      (await signIn(app, "ada@example.com", PASSWORD)).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("lists and reads back through the store, speaking the same query every list does", async () => {
    await users.create({ email: "ada@example.com" });
    await users.create({ email: "alan@example.com" });

    const page = await users.list({
      where: { email: { op: "contains", value: "alan" } },
    });
    expect(page.map((user) => user.email)).toEqual(["alan@example.com"]);
    expect((await users.get(page[0]?.id as string)).email).toBe("alan@example.com");
  });

  it("refuses a duplicate address, on create and on rename", async () => {
    const ada = await users.create({ email: "ada@example.com" });
    await users.create({ email: "alan@example.com" });

    await expect(users.create({ email: "ada@example.com" })).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
    await expect(
      users.update(ada.id, { email: "alan@example.com" }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    // Keeping one's own address is not a collision.
    expect(
      (await users.update(ada.id, { email: "ada@example.com", name: "Ada" })).name,
    ).toBe("Ada");
  });

  it("sets a password on an account that had none, and revokes every session on a change", async () => {
    const ada = await users.create({ email: "ada@example.com" });

    await users.update(ada.id, { password: PASSWORD });
    const session = await signIn(app, "ada@example.com", PASSWORD);
    expect(session.status).toBe(200);
    const cookie = session.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");

    await users.update(ada.id, { password: "another long password" });

    const me = await app.handler(
      new Request("http://localhost/api/auth/get-session", { headers: { cookie } }),
    );
    expect(await me.json()).toBeNull();
    expect((await signIn(app, "ada@example.com", "another long password")).status).toBe(
      200,
    );
  });

  it("removes the account with its sessions and links, and answers 404 afterwards", async () => {
    const ada = await users.create({ email: "ada@example.com", password: PASSWORD });
    await signIn(app, "ada@example.com", PASSWORD);

    await users.remove(ada.id);

    await expect(users.get(ada.id)).rejects.toBeInstanceOf(UserNotFoundError);
    await expect(users.remove(ada.id)).rejects.toBeInstanceOf(UserNotFoundError);
    expect(
      (await signIn(app, "ada@example.com", PASSWORD)).status,
    ).toBeGreaterThanOrEqual(400);
  });
});
