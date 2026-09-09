import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { create, type AccessContext } from "@shuri/sdk";
import { createMemoryAdapter } from "@shuri/store-memory";
import { beforeEach, describe, expect, it } from "vitest";
import { betterAuthPlugin } from "../plugin.js";

/*
 * `@shuri/api`'s access control over real better-auth sessions: signing up turns a visitor into a
 * principal, an op with no rule then needs one, a `Where` rule scopes rows to their author, and the
 * OpenAPI document says the session cookie is how requests authenticate.
 */
const mine = (ctx: AccessContext) =>
  ctx.user ? { author: { op: "eq" as const, value: ctx.user.id } } : false;

const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    access: { list: () => true, view: () => true, update: mine, delete: mine },
    fields: [
      { type: "text", name: "title", required: true },
      { type: "text", name: "author", required: true },
    ],
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
    },
  });
  return create({
    collections,
    globals,
    adapter: createMemoryAdapter(),
    plugins: [ba],
    realtime: { heartbeatMs: 0 },
  });
}

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp();
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

async function signUp(): Promise<{ cookie: string; id: string }> {
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ ...CREDENTIALS, name: "Ada" }),
  });
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  const { user } = (await response.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

describe("access control over better-auth sessions", () => {
  it("guards an op with no rule: anonymous 401, signed-in allowed", async () => {
    const body = { method: "POST", body: JSON.stringify({ title: "x", author: "y" }) };

    expect((await request("/collections/posts", body)).status).toBe(401);
    const ada = await signUp();
    expect(
      (await request("/collections/posts", body, { cookie: ada.cookie })).status,
    ).toBe(201);
  });

  it("lets the public read, and only the author edit", async () => {
    const ada = await signUp();
    const post = await app.collections.posts.insert({ title: "Mine", author: ada.id });
    const other = await app.collections.posts.insert({
      title: "Theirs",
      author: "someone",
    });

    expect((await request("/collections/posts")).status).toBe(200);
    expect((await request("/globals/site")).status).toBe(200);

    const asAda = { cookie: ada.cookie };
    const patch = { method: "PATCH", body: JSON.stringify({ title: "Edited" }) };
    expect((await request(`/collections/posts/${other.id}`, patch, asAda)).status).toBe(
      404,
    );
    expect((await request(`/collections/posts/${post.id}`, patch, asAda)).status).toBe(
      200,
    );
  });

  it("hands a hook the principal behind an HTTP write", async () => {
    const seen: string[] = [];
    app.hooks.onCollection("posts", "afterChange", ({ context }) => {
      seen.push(context.principal?.kind ?? "none");
    });
    const ada = await signUp();

    await request(
      "/collections/posts",
      { method: "POST", body: JSON.stringify({ title: "x", author: ada.id }) },
      { cookie: ada.cookie },
    );

    expect(seen).toEqual(["user"]);
  });

  it("describes the session cookie as how requests authenticate", async () => {
    const document = (await (
      await app.handler(new Request("http://localhost/openapi.json"))
    ).json()) as {
      paths: Record<string, Record<string, unknown>>;
      components: {
        securitySchemes: Record<string, { name: string }>;
        schemas: Record<string, unknown>;
      };
    };

    expect(document.components.securitySchemes["cookieAuth"]?.name).toBe(
      "better-auth.session_token",
    );
    expect(document.paths["/collections/posts"]["post"]).toMatchObject({
      security: [{ cookieAuth: [] }],
    });
    // better-auth's tables stay out of the document, as any internal collection does.
    expect(document.components.schemas["user"]).toBeUndefined();
    expect(document.components.schemas["session"]).toBeUndefined();
  });
});
