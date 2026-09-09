import { apiKey } from "@better-auth/api-key";
import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { create } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { beforeEach, describe, expect, it } from "vitest";
import type { IssueApiKeyInput } from "../api-key.js";
import { betterAuthPlugin } from "../plugin.js";

/*
 * Machine-to-machine access over `@better-auth/api-key`: a key becomes a `client` principal whose
 * scopes come from the key's permissions, `@shuri/api`'s policy gates every op on them ahead of
 * any rule, and the OpenAPI document says where the key goes.
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

const globals = [
  {
    slug: "site",
    title: "Site",
    category: { title: "Geral" },
    access: { read: () => true },
    fields: [{ type: "text", name: "name" }],
  },
] as const satisfies readonly GlobalSchema[];

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
      plugins: [apiKey({ enableMetadata: true })],
    },
  });
  const app = create({
    collections,
    globals,
    adapter: createMemoryAdapter(),
    plugins: [ba],
  });
  return { app, ba };
}

let app: ReturnType<typeof createApp>["app"];
let ba: ReturnType<typeof createApp>["ba"];

beforeEach(() => {
  ({ app, ba } = createApp());
});

function request(
  path: string,
  init: RequestInit = {},
  headers: Record<string, string> = {},
) {
  return app.handler(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

const POST_BODY = { method: "POST", body: JSON.stringify({ title: "x" }) };

let owners = 0;

async function signUp(
  email = CREDENTIALS.email,
): Promise<{ cookie: string; id: string }> {
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ ...CREDENTIALS, email, name: "Ada" }),
  });
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  const { user } = (await response.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

async function issue(body: Omit<IssueApiKeyInput, "userId">): Promise<string> {
  // Every key gets an owner of its own; better-auth refuses a second signup of one address.
  owners += 1;
  const owner = await signUp(`owner-${owners}@example.com`);
  const created = await ba.apiKeys.create({ name: "bot", ...body, userId: owner.id });
  return created.key;
}

describe("API keys as client principals", () => {
  it("lets a key do what its permissions name, and refuses the rest with 403", async () => {
    const key = await issue({ permissions: { posts: ["list", "view"] } });
    const asBot = { "x-api-key": key };

    expect((await request("/collections/posts", {}, asBot)).status).toBe(200);
    expect((await request("/collections/posts", POST_BODY, asBot)).status).toBe(403);
    // `site.read` has a rule saying yes to everyone — the scope check comes first, and a client
    // without `site:read` never reaches it.
    expect((await request("/globals/site", {}, asBot)).status).toBe(403);
  });

  it("expands a wildcard against the schema", async () => {
    const everything = await issue({ permissions: { "*": ["*"] } });
    const posts = await issue({ permissions: { posts: ["*"] } });

    expect(
      (await request("/collections/posts", POST_BODY, { "x-api-key": everything }))
        .status,
    ).toBe(201);
    expect((await request("/globals/site", {}, { "x-api-key": everything })).status).toBe(
      200,
    );
    expect(
      (await request("/collections/posts", POST_BODY, { "x-api-key": posts })).status,
    ).toBe(201);
    expect((await request("/globals/site", {}, { "x-api-key": posts })).status).toBe(403);
  });

  it("treats an unknown key as nobody: 401, not 403", async () => {
    expect(
      (await request("/collections/posts", POST_BODY, { "x-api-key": "not-a-key" }))
        .status,
    ).toBe(401);
  });

  it("counts every request against the key's remaining uses", async () => {
    const key = await issue({ permissions: { posts: ["create"] }, remaining: 1 });
    const asBot = { "x-api-key": key };

    // A write, not a public read: a spent key is nobody, and nobody may still list.
    expect((await request("/collections/posts", POST_BODY, asBot)).status).toBe(201);
    expect((await request("/collections/posts", POST_BODY, asBot)).status).toBe(401);
  });

  it("accepts the key as a bearer too, and hands a hook the client behind the write", async () => {
    const seen: unknown[] = [];
    app.hooks.onCollection("posts", "afterChange", ({ context }) => {
      seen.push(context.principal);
    });
    const key = await issue({
      permissions: { posts: ["create"] },
      metadata: { env: "ci" },
    });

    const response = await request("/collections/posts", POST_BODY, {
      authorization: `Bearer ${key}`,
    });

    expect(response.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: "client",
      client: { name: "bot", metadata: { env: "ci" } },
    });
  });

  it("puts the key ahead of a session cookie, and leaves a cookie alone a user", async () => {
    const ada = await signUp();
    const key = await issue({ permissions: { posts: ["list"] } });
    const seen: string[] = [];
    app.hooks.onCollection("posts", "afterChange", ({ context }) => {
      seen.push(context.principal?.kind ?? "none");
    });

    // A user may create (no rule, signed in); the key's client may not (no scope) — so the 403 is
    // the proof of which one the request was resolved as.
    expect(
      (
        await request("/collections/posts", POST_BODY, {
          cookie: ada.cookie,
          "x-api-key": key,
        })
      ).status,
    ).toBe(403);
    expect(
      (await request("/collections/posts", POST_BODY, { cookie: ada.cookie })).status,
    ).toBe(201);
    expect(seen).toEqual(["user"]);
  });

  it("describes the key header in the OpenAPI document, next to the cookie", async () => {
    const document = (await (
      await app.handler(new Request("http://localhost/openapi.json"))
    ).json()) as {
      paths: Record<string, Record<string, { security: unknown }>>;
      components: {
        securitySchemes: Record<string, unknown>;
        schemas: Record<string, unknown>;
      };
    };

    expect(document.components.securitySchemes["apiKeyAuth"]).toEqual({
      type: "apiKey",
      in: "header",
      name: "x-api-key",
    });
    expect(document.paths["/collections/posts"]?.["post"]?.security).toEqual([
      { cookieAuth: [] },
      { apiKeyAuth: [] },
    ]);
    expect(document.components.schemas["apikey"]).toBeUndefined();
  });
});
