import type { CollectionSchema } from "@shuri/core";
import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { createAdminHandler } from "@shuri/ui";
import type { AdminSchema } from "@shuri/ui/shared";
import { describe, expect, it } from "vitest";
import { betterAuthPlugin } from "../plugin.js";

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

const ADMIN = { email: "admin@example.com", password: "correct horse battery staple" };
const OTHER = { email: "rando@example.com", password: "correct horse battery staple" };

/**
 * Builds an app whose admin is guarded by better-auth: the session source and the credential
 * paths both come off the plugin, and `createAdminHandler` needs nothing else.
 * @returns The app and the plugin backing it.
 */
function createApp() {
  const ba = betterAuthPlugin({
    options: {
      baseURL: "http://localhost",
      secret: "test-secret-at-least-32-characters-long",
      emailAndPassword: { enabled: true },
    },
  });

  const app = create({
    collections,
    adapter: createMemoryAdapter(),
    plugins: [
      ba,
      {
        name: "admin",
        handlers: () => [
          createAdminHandler(
            { collections },
            {
              assets: false,
              auth: {
                auth: ba.sessionSource,
                basePath: ba.basePath,
                authorize: (session) => session.user.email === ADMIN.email,
              },
            },
          ),
        ],
      },
    ],
  });
  return { app, ba };
}

const post = (path: string, body: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Signs a user up and returns the cookie header a browser would send back afterwards.
 * @param app - The app to sign up against.
 * @param credentials - The email and password to register.
 * @returns The `cookie` header value carrying the new session.
 */
async function signUp(
  app: ReturnType<typeof createApp>["app"],
  credentials: typeof ADMIN,
): Promise<string> {
  const response = await app.handler(
    post("/api/auth/sign-up/email", { ...credentials, name: "Someone" }),
  );
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

const schemaOf = async (
  app: ReturnType<typeof createApp>["app"],
  cookie?: string,
): Promise<AdminSchema> => {
  const response = await app.handler(
    new Request("http://localhost/admin/schema.json", {
      headers: cookie ? { cookie } : {},
    }),
  );
  return (await response.json()) as AdminSchema;
};

describe("the admin, guarded by better-auth", () => {
  it("advertises better-auth's own credential routes to the login form", async () => {
    const { app } = createApp();

    const schema = await schemaOf(app);

    expect(schema.auth).toEqual({
      basePath: "/api/auth",
      signIn: "/api/auth/sign-in/email",
      signOut: "/api/auth/sign-out",
      providers: [],
    });
  });

  it("withholds the collections from a signed-out visitor", async () => {
    const { app } = createApp();

    const schema = await schemaOf(app);

    expect(schema.viewer).toEqual({ status: "anonymous" });
    expect(schema.collections).toEqual([]);
  });

  it("serves the whole schema to an authorized better-auth session", async () => {
    const { app } = createApp();
    const cookie = await signUp(app, ADMIN);

    const schema = await schemaOf(app, cookie);

    expect(schema.viewer?.status).toBe("allowed");
    expect(schema.collections.map((entry) => entry.slug)).toEqual(["posts"]);
  });

  it("names a signed-in user the host's authorize refuses", async () => {
    const { app } = createApp();
    const cookie = await signUp(app, OTHER);

    const schema = await schemaOf(app, cookie);

    expect(schema.viewer).toMatchObject({
      status: "forbidden",
      user: { email: OTHER.email },
    });
    expect(schema.collections).toEqual([]);
  });

  it("refuses an anonymous write and allows an authorized one", async () => {
    const { app } = createApp();

    const anonymous = await app.handler(post("/collections/posts", { title: "pwned" }));
    expect(anonymous.status).toBe(401);

    const cookie = await signUp(app, ADMIN);
    const allowed = await app.handler(
      new Request("http://localhost/collections/posts", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ title: "ok" }),
      }),
    );
    expect(allowed.status).toBe(201);
  });

  it("answers 403 for a signed-in user without access", async () => {
    const { app } = createApp();
    const cookie = await signUp(app, OTHER);

    const response = await app.handler(
      new Request("http://localhost/collections/posts", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ title: "nope" }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("keeps reads public, which is the admin's default", async () => {
    const { app } = createApp();

    const response = await app.handler(new Request("http://localhost/collections/posts"));

    expect(response.status).toBe(200);
  });
});
