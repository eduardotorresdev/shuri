import { apiKey } from "@better-auth/api-key";
import type { CollectionSchema } from "@shuri/core";
import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { createAdminHandler } from "@shuri/ui";
import { describe, expect, it } from "vitest";
import { ApiKeysNotEnabledError } from "../api-key.js";
import { betterAuthPlugin } from "../plugin.js";

/*
 * API keys next to `@shuri/ui`'s admin — whose guard speaks sessions and has to be told to leave a
 * keyed request alone — and the plugin's behaviour when `@better-auth/api-key` is not on at all.
 */
const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    access: { list: () => true, view: () => true },
    fields: [{ type: "text", name: "title", required: true }],
  },
] as const satisfies readonly CollectionSchema[];

const CREDENTIALS = {
  email: "ada@example.com",
  password: "correct horse battery staple",
};

describe("beside the admin", () => {
  it("is exempt from the admin's guard, which only speaks sessions", async () => {
    const guarded = betterAuthPlugin({
      options: {
        baseURL: "http://localhost",
        secret: "test-secret-at-least-32-characters-long",
        emailAndPassword: { enabled: true },
        plugins: [apiKey()],
      },
    });
    const admin = create({
      collections,
      adapter: createMemoryAdapter(),
      plugins: [
        guarded,
        {
          name: "admin",
          handlers: () => [
            createAdminHandler(
              { collections },
              {
                auth: { auth: guarded.sessionSource, exempt: guarded.carriesApiKey },
                assets: new Map(),
              },
            ),
          ],
        },
      ],
    });
    const signup = await admin.handler(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...CREDENTIALS, name: "Ada" }),
      }),
    );
    const { user } = (await signup.json()) as { user: { id: string } };
    const issued = await guarded.apiKeys.create({
      userId: user.id,
      permissions: { posts: ["create"] },
    });
    const write = (headers: Record<string, string>) =>
      admin.handler(
        new Request("http://localhost/collections/posts", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ title: "x" }),
        }),
      );

    expect(guarded.carriesApiKey(new Request("http://localhost/x"))).toBe(false);
    expect(
      guarded.carriesApiKey(
        new Request("http://localhost/x", { headers: { authorization: "Bearer k" } }),
      ),
    ).toBe(true);
    expect((await write({ "x-api-key": issued.key })).status).toBe(201);
    // Still the guard's: no key, no session.
    expect((await write({})).status).toBe(401);
    // Exempt, then judged by the API: an unknown key is anonymous there.
    expect((await write({ "x-api-key": "nope" })).status).toBe(401);
  });
});

describe("without @better-auth/api-key", () => {
  it("refuses to mint, and treats a key header as no credential", async () => {
    const plain = betterAuthPlugin({
      options: {
        baseURL: "http://localhost",
        secret: "test-secret-at-least-32-characters-long",
        emailAndPassword: { enabled: true },
      },
    });
    const bare = create({
      collections,
      adapter: createMemoryAdapter(),
      plugins: [plain],
    });

    await expect(plain.apiKeys.create({ userId: "u" })).rejects.toBeInstanceOf(
      ApiKeysNotEnabledError,
    );
    // Nothing is exempted by a stray header either.
    expect(
      plain.carriesApiKey(
        new Request("http://localhost/x", { headers: { "x-api-key": "anything" } }),
      ),
    ).toBe(false);
    const response = await bare.handler(
      new Request("http://localhost/collections/posts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "anything" },
        body: JSON.stringify({ title: "x" }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
