import { createMemoryAdapter } from "@shuri/store-memory";
import { create } from "@shuri/sdk";
import type { CollectionSchema } from "@shuri/core";
import { beforeEach, describe, expect, it } from "vitest";
import { betterAuthPlugin } from "../plugin.js";
import { recordingAdapter } from "../test-support.js";

const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    // Public reads, declared: with the plugin resolving a principal, an op with no rule needs a
    // signed-in one.
    access: { list: () => true, view: () => true },
    fields: [{ type: "text", name: "title", required: true }],
  },
] as const satisfies readonly CollectionSchema[];

const CREDENTIALS = {
  email: "ada@example.com",
  password: "correct horse battery staple",
};

function createApp() {
  const ba = betterAuthPlugin({
    options: {
      baseURL: "http://localhost",
      secret: "test-secret-at-least-32-characters-long",
      emailAndPassword: { enabled: true },
    },
  });
  const app = create({ collections, adapter: createMemoryAdapter(), plugins: [ba] });
  return { app, ba };
}

const json = (path: string, body: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("better-auth on a Shuri store", () => {
  let app: ReturnType<typeof createApp>["app"];
  let ba: ReturnType<typeof createApp>["ba"];

  beforeEach(() => {
    ({ app, ba } = createApp());
  });

  it("signs a user up through the app's own handler", async () => {
    const response = await app.handler(
      json("/api/auth/sign-up/email", { ...CREDENTIALS, name: "Ada" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { email: CREDENTIALS.email } });
  });

  it("writes better-auth's rows through the app's own adapter", async () => {
    const recording = recordingAdapter(createMemoryAdapter());
    const plugin = betterAuthPlugin({
      options: {
        baseURL: "http://localhost",
        secret: "test-secret-at-least-32-characters-long",
        emailAndPassword: { enabled: true },
      },
    });
    const watched = create({
      collections,
      adapter: recording.adapter,
      plugins: [plugin],
    });

    await watched.handler(
      json("/api/auth/sign-up/email", { ...CREDENTIALS, name: "Ada" }),
    );

    // Signing up writes a user, the account holding its password, and the session it opens — all
    // three onto the same adapter the app's own `posts` collection uses.
    expect(
      recording.writes.filter((write) => write.op === "insert").map((w) => w.slug),
    ).toEqual(expect.arrayContaining(["user", "account", "session"]));
  });

  it("stores the user row where the app's store can read it back", async () => {
    const recording = recordingAdapter(createMemoryAdapter());
    const plugin = betterAuthPlugin({
      options: {
        baseURL: "http://localhost",
        secret: "test-secret-at-least-32-characters-long",
        emailAndPassword: { enabled: true },
      },
    });
    const watched = create({
      collections,
      adapter: recording.adapter,
      plugins: [plugin],
    });

    await watched.handler(
      json("/api/auth/sign-up/email", { ...CREDENTIALS, name: "Ada" }),
    );

    const users = await recording.rows("user");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: CREDENTIALS.email, name: "Ada" });
    // The id came from the store, not from better-auth: `disableIdGeneration` is what makes the two
    // agree about who owns it.
    expect(typeof users[0]?.id).toBe("string");
  });

  it("never lets better-auth's tables onto app.collections", () => {
    expect(Object.keys(app.collections)).toEqual(["posts"]);
  });

  it("signs in and hands back a session cookie", async () => {
    await app.handler(json("/api/auth/sign-up/email", { ...CREDENTIALS, name: "Ada" }));

    const response = await app.handler(json("/api/auth/sign-in/email", CREDENTIALS));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join(";")).toContain("session_token");
  });

  it("resolves that cookie back to a session, in the admin's shape", async () => {
    await app.handler(json("/api/auth/sign-up/email", { ...CREDENTIALS, name: "Ada" }));
    const signIn = await app.handler(json("/api/auth/sign-in/email", CREDENTIALS));
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    const session = await ba.sessionSource.getSession(
      new Request("http://localhost/collections/posts", { headers: { cookie } }),
    );

    expect(session?.user.email).toBe(CREDENTIALS.email);
    expect(session?.user.name).toBe("Ada");
    expect(typeof session?.expiresAt).toBe("number");
  });

  it("has no session for a request carrying no cookie", async () => {
    expect(
      await ba.sessionSource.getSession(
        new Request("http://localhost/collections/posts"),
      ),
    ).toBeUndefined();
  });

  it("refuses a wrong password", async () => {
    await app.handler(json("/api/auth/sign-up/email", { ...CREDENTIALS, name: "Ada" }));

    const response = await app.handler(
      json("/api/auth/sign-in/email", {
        ...CREDENTIALS,
        password: "wrong password here",
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("leaves the app's own routes alone, guarded by their own rules", async () => {
    const response = await app.handler(new Request("http://localhost/collections/posts"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
