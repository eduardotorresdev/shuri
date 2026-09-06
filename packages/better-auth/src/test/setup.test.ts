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
    fields: [{ type: "text", name: "title", required: true }],
  },
] as const satisfies readonly CollectionSchema[];

const FIRST = { email: "first@example.com", password: "correct horse battery staple" };

/**
 * Builds an app whose admin is in first-run mode: no account exists, so the setup route is open.
 * @param [token] - The one-time token to require, when the test is exercising one.
 * @returns The app and the plugin backing it.
 */
function createApp(token?: string) {
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
                signInPath: `${ba.basePath}/sign-in/email`,
                signOutPath: `${ba.basePath}/sign-out`,
                setup: { source: ba.setupSource, ...(token ? { token } : {}) },
              },
            },
          ),
        ],
      },
    ],
  });
  return { app, ba };
}

type App = ReturnType<typeof createApp>["app"];

const setup = (app: App, body: unknown): Promise<Response> =>
  app.handler(
    new Request("http://localhost/admin/setup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify(body),
    }),
  );

const schemaOf = async (app: App, cookie?: string): Promise<AdminSchema> => {
  const response = await app.handler(
    new Request("http://localhost/admin/schema.json", {
      headers: cookie ? { cookie } : {},
    }),
  );
  return (await response.json()) as AdminSchema;
};

const cookieOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");

describe("first-run setup", () => {
  it("tells a fresh app's admin to show the first-account form", async () => {
    const { app } = createApp();

    const schema = await schemaOf(app);

    expect(schema.viewer).toEqual({ status: "setup" });
    expect(schema.auth?.setup).toEqual({ path: "/admin/setup", tokenRequired: false });
    expect(schema.collections).toEqual([]);
  });

  it("creates the account and signs in, in one request", async () => {
    const { app } = createApp();

    const response = await setup(app, FIRST);

    expect(response.ok).toBe(true);
    const schema = await schemaOf(app, cookieOf(response));
    expect(schema.viewer).toMatchObject({
      status: "allowed",
      user: { email: FIRST.email },
    });
  });

  it("closes the moment the account exists", async () => {
    const { app } = createApp();
    await setup(app, FIRST);

    const schema = await schemaOf(app);
    expect(schema.viewer).toEqual({ status: "anonymous" });
    expect(schema.auth?.setup).toBeUndefined();

    const second = await setup(app, {
      email: "second@example.com",
      password: FIRST.password,
    });
    expect(second.status).toBe(409);
  });

  it("refuses two simultaneous attempts, so only one account is ever the first", async () => {
    const { app, ba } = createApp();

    const [a, b] = await Promise.all([
      setup(app, FIRST),
      setup(app, { email: "second@example.com", password: FIRST.password }),
    ]);

    expect([a.status, b.status].filter((status) => status === 409)).toHaveLength(1);
    expect(await ba.setupSource.required()).toBe(false);
  });

  it("still guards the REST writes while setup is pending", async () => {
    const { app } = createApp();

    const response = await app.handler(
      new Request("http://localhost/collections/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "pwned" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a bad body with per-field issues the form can render", async () => {
    const { app } = createApp();

    const response = await setup(app, { email: "not-an-email", password: "short" });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues.map((issue) => issue.path).toSorted()).toEqual([
      "body.email",
      "body.password",
    ]);
  });

  it("leaves the app in first-run mode after a rejected attempt", async () => {
    const { app } = createApp();
    await setup(app, { email: "nope", password: "x" });

    expect((await schemaOf(app)).viewer).toEqual({ status: "setup" });
  });

  it("requires the token when the host set one, and says so in the schema", async () => {
    const { app } = createApp("s3cret-token");

    expect((await schemaOf(app)).auth?.setup?.tokenRequired).toBe(true);
    expect((await setup(app, FIRST)).status).toBe(403);
    expect((await setup(app, { ...FIRST, token: "wrong" })).status).toBe(403);
    expect((await setup(app, { ...FIRST, token: "s3cret-token" })).ok).toBe(true);
  });

  it("stamps the fields `authorize` will read onto the account it creates", async () => {
    const ba = betterAuthPlugin({
      options: {
        baseURL: "http://localhost",
        secret: "test-secret-at-least-32-characters-long",
        emailAndPassword: { enabled: true },
        // Declared to better-auth, not only written to the store: better-auth parses a user against
        // its own schema on the way out, so a column it does not know about never reaches a session.
        // Declaring it here also puts it on the derived Shuri collection, so it is validated too.
        user: {
          additionalFields: { role: { type: "string", required: false, input: false } },
        },
      },
      setup: { fields: { role: "admin" } },
    });
    let seenRole: unknown;
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
                  setup: { source: ba.setupSource },
                  authorize: (session) => {
                    seenRole = session.user["role"];
                    return session.user["role"] === "admin";
                  },
                },
              },
            ),
          ],
        },
      ],
    });

    const created = await setup(app, FIRST);
    const schema = await schemaOf(app, cookieOf(created));

    expect(seenRole).toBe("admin");
    expect(schema.viewer?.status).toBe("allowed");
  });

  it("declines anything but a POST to the setup route", async () => {
    const { app } = createApp();

    const response = await app.handler(new Request("http://localhost/admin/setup"));

    expect(response.status).toBe(405);
  });
});
