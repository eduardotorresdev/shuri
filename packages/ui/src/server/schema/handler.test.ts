import type { FallingHandler } from "@shuri/api";
import { describe, expect, it } from "vitest";
import { resolveAdminAuth } from "../auth/access.js";
import { asUser, stubSessions } from "../auth/test-support.js";
import type { AdminAuthOptions } from "../auth/types.js";
import type { AdminSchema } from "../../shared/schema.js";
import { buildAdminSchema } from "./build.js";
import { createAdminSchemaHandler } from "./handler.js";

const schema = buildAdminSchema({
  collections: [
    { slug: "posts", title: "Posts", singular: "Post", plural: "Posts", fields: [] },
  ],
});
const handler = createAdminSchemaHandler(schema);

describe("createAdminSchemaHandler", () => {
  it("serves the document at {basePath}/schema.json", async () => {
    const response = await handler(new Request("http://x/admin/schema.json"));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual(schema);
  });

  it("keeps the document out of caches, so a deploy can't leave stale forms behind", async () => {
    const response = await handler(new Request("http://x/admin/schema.json"));

    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("declines everything else, so the next handler in the chain gets its turn", async () => {
    expect(await handler(new Request("http://x/admin"))).toBeUndefined();
    expect(await handler(new Request("http://x/collections/posts"))).toBeUndefined();
    expect(
      await handler(new Request("http://x/admin/schema.json", { method: "POST" })),
    ).toBeUndefined();
  });
});

/**
 * Reads the schema document a handler serves to the caller named by `token`.
 * @param serve - The handler under test.
 * @param [token] - The token naming the user, absent for an anonymous read.
 * @returns The document served.
 */
async function readSchema(serve: FallingHandler, token?: string): Promise<AdminSchema> {
  const response = await serve(asUser(token, new Request("http://x/admin/schema.json")));
  return (await response?.json()) as AdminSchema;
}

describe("createAdminSchemaHandler with auth", () => {
  const api = { collections: "/collections", globals: "/globals", events: "/events" };
  const sessions = stubSessions({ ada: { email: "ada@example.com", role: "editor" } });
  const withAuth = (options: Partial<AdminAuthOptions> = {}) =>
    createAdminSchemaHandler(
      {
        ...schema,
        auth: {
          basePath: "/auth",
          signIn: "/auth/login",
          signOut: "/auth/logout",
          providers: [],
        },
      },
      resolveAdminAuth({ auth: sessions, ...options }, api),
    );

  const read = readSchema;

  it("tells an anonymous caller where to sign in, and nothing else", async () => {
    const document = await read(withAuth());

    expect(document.viewer).toEqual({ status: "anonymous" });
    // The resolved options win over the document's own literal, defaults included.
    expect(document.auth?.basePath).toBe("/api/auth");
    expect(document.auth?.signIn).toBe("/api/auth/sign-in/email");
    expect(document.collections).toEqual([]);
    expect(document.globals).toEqual([]);
  });

  it("withholds the collection slugs themselves, not just their fields", async () => {
    const response = await withAuth()(new Request("http://x/admin/schema.json"));

    expect(await response?.text()).not.toContain("posts");
  });

  it("serves the whole document to an authorized session", async () => {
    const document = await read(withAuth(), "ada");

    expect(document.viewer).toEqual({
      status: "allowed",
      user: { id: "u1", email: "ada@example.com" },
    });
    expect(document.collections.map((entry) => entry.slug)).toEqual(["posts"]);
  });

  it("names a refused user but still withholds the content", async () => {
    const document = await read(withAuth({ authorize: () => false }), "ada");

    expect(document.viewer?.status).toBe("forbidden");
    expect(document.collections).toEqual([]);
  });

  it("stays out of shared caches, since it now varies by session", async () => {
    const response = await withAuth()(new Request("http://x/admin/schema.json"));

    expect(response?.headers.get("cache-control")).toBe("no-store");
  });
});
