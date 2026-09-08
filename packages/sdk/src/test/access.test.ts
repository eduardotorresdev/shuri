import { createMemoryAdapter } from "@shuri/store-memory";
import { beforeEach, describe, expect, it } from "vitest";
import { create, type AccessContext } from "../index.js";

/**
 * Payload-style access rules end to end through `create()`: a `Where` rule scoping posts to their
 * author, a public read on a global, and a client-credentials client capped by its scopes — all on
 * one app, one store, one handler.
 */
const credentials = { email: "ada@example.com", password: "correct-horse-battery" };

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
] as const;

const globals = [
  {
    slug: "site",
    title: "Site",
    category: { title: "Geral" },
    access: { read: () => true },
    fields: [{ type: "text", name: "name" }],
  },
] as const;

let app: ReturnType<typeof buildApp>;

function buildApp() {
  return create({
    collections,
    globals,
    adapter: createMemoryAdapter(),
    auth: {
      cookie: { secure: false },
      clients: { roles: { integrator: ["posts:list", "posts:view"] } },
    },
    realtime: { heartbeatMs: 0 },
  });
}

beforeEach(() => {
  app = buildApp();
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
  const response = await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
  const header = response.headers.get("set-cookie") as string;
  const cookie = decodeURIComponent(header.slice("shuri_session=".length).split(";")[0]);
  const { user } = (await response.json()) as { user: { id: string } };
  return { cookie, id: user.id };
}

describe("an app with access rules", () => {
  it("lets the public read, and only the author edit", async () => {
    const ada = await signUp();
    const post = await app.collections.posts.insert({ title: "Mine", author: ada.id });
    const other = await app.collections.posts.insert({
      title: "Theirs",
      author: "someone",
    });

    expect((await request("/collections/posts")).status).toBe(200);
    expect((await request("/globals/site")).status).toBe(200);
    expect(
      (await request("/collections/posts", { method: "POST", body: JSON.stringify({}) }))
        .status,
    ).toBe(401);

    const asAda = { cookie: `shuri_session=${ada.cookie}` };
    const patch = { method: "PATCH", body: JSON.stringify({ title: "Edited" }) };
    expect((await request(`/collections/posts/${other.id}`, patch, asAda)).status).toBe(
      404,
    );
    expect((await request(`/collections/posts/${post.id}`, patch, asAda)).status).toBe(
      200,
    );
    expect(
      (
        await request(
          "/collections/posts",
          { method: "POST", body: JSON.stringify({ title: "New", author: ada.id }) },
          asAda,
        )
      ).status,
    ).toBe(201);
  });

  it("caps a client at its scopes, and issues its token over the RFC endpoint", async () => {
    const { client, clientSecret } = await app.auth.clients.create({
      name: "CI",
      roles: ["integrator"],
    });
    const basic = btoa(`${client.clientId}:${clientSecret}`);
    const token = await request(
      "/auth/token",
      { method: "POST", body: "grant_type=client_credentials&scope=posts:list" },
      {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    );
    expect(token.status).toBe(200);
    const { access_token } = (await token.json()) as { access_token: string };
    const bearer = { authorization: `Bearer ${access_token}` };

    expect((await request("/collections/posts", {}, bearer)).status).toBe(200);
    expect(
      (
        await request(
          "/collections/posts",
          { method: "POST", body: JSON.stringify({ title: "x", author: "y" }) },
          bearer,
        )
      ).status,
    ).toBe(403);
    expect((await request("/globals/site", {}, bearer)).status).toBe(403);
  });
});
