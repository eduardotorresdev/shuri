import type { Principal } from "@shuri/core";
import { createMemoryAdapter } from "@shuri/store-memory";
import { beforeEach, describe, expect, it } from "vitest";
import { create, type AccessContext, type ShuriPlugin } from "../index.js";

/*
 * Payload-style access rules end to end through `create()`, with the principal coming from a
 * plugin: a `Where` rule scoping posts to their author, a public read on a global, and the OpenAPI
 * document describing how requests authenticate — all on one app, one store, one handler.
 *
 * The plugin here is a stub reading a bearer token, not a real auth implementation: what this test
 * covers is the wiring between `plugins[].principal` and `@shuri/api`'s access control. The same
 * flow over real sessions lives in `@shuri/better-auth`'s tests.
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

/** Whoever sends `Authorization: Bearer <id>` is the user with that id. */
const bearerAuth: ShuriPlugin = {
  name: "bearer",
  principal: async (incoming): Promise<Principal> => {
    const id = incoming.headers.get("authorization")?.replace(/^Bearer /, "");
    return id ? { kind: "user", user: { id } } : { kind: "anonymous" };
  },
  openapi: {
    security: {
      schemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      requirements: () => [{ bearerAuth: [] }],
    },
  },
};

let app: ReturnType<typeof buildApp>;

function buildApp() {
  return create({
    collections,
    globals,
    adapter: createMemoryAdapter(),
    plugins: [bearerAuth],
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

describe("an app with access rules", () => {
  it("lets the public read, and only the author edit", async () => {
    const post = await app.collections.posts.insert({ title: "Mine", author: "ada" });
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

    const asAda = { authorization: "Bearer ada" };
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
          { method: "POST", body: JSON.stringify({ title: "New", author: "ada" }) },
          asAda,
        )
      ).status,
    ).toBe(201);
  });

  it("refuses an op with no rule to anonymous, and answers 401 rather than 403", async () => {
    const response = await request("/globals/site", {
      method: "PATCH",
      body: JSON.stringify({ name: "x" }),
    });

    expect(response.status).toBe(401);
  });

  it("describes how requests authenticate, on every guarded operation", async () => {
    const document = (await (
      await app.handler(new Request("http://localhost/openapi.json"))
    ).json()) as {
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: Record<string, unknown> };
    };

    expect(Object.keys(document.components.securitySchemes)).toEqual(["bearerAuth"]);
    expect(document.paths["/collections/posts"]["post"]).toMatchObject({
      security: [{ bearerAuth: [] }],
    });
  });
});
