import type { CollectionSchema } from "@shuri/core";
import type { UserAdminApi } from "@shuri/auth";
import { describe, expect, it } from "vitest";
import { createAdminHandler } from "../handler.js";
import { asUser, stubSessions } from "../auth/test-support.js";
import type { AdminAssets } from "../assets/types.js";
import type { AdminSchema } from "../../shared/schema.js";

const collections: CollectionSchema[] = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [{ type: "text", name: "title", required: true }],
  },
];

const bundle: AdminAssets = new Map([
  [
    "index.html",
    {
      body: new TextEncoder().encode("<!doctype html><body>admin</body>"),
      contentType: "text/html; charset=utf-8",
      immutable: false,
    },
  ],
]);

describe("the admin with user administration", () => {
  const sessions = stubSessions({
    ada: { id: "u1", email: "ada@example.com", role: "editor" },
    bob: { id: "u2", email: "bob@example.com", role: "reader" },
  });
  /** The one account, standing in for `app.auth.users` — enough to prove the route is wired up. */
  const usersApi: UserAdminApi = {
    list: async () => [{ id: "u1", email: "ada@example.com", createdAt: 1 }],
    get: async (id) => ({ id, email: "ada@example.com", createdAt: 1 }),
    create: async (input) => ({ id: "u9", createdAt: 9, ...input }),
    update: async (id) => ({ id, email: "ada@example.com", createdAt: 1 }),
    remove: async () => undefined,
  };
  it("advertises the users screens only to a caller who may use them", async () => {
    const withUsers = createAdminHandler(
      { collections },
      {
        assets: bundle,
        auth: {
          auth: { ...sessions, users: usersApi },
          authorize: (session) => session.user["role"] === "editor",
        },
      },
    );
    const schemaFor = async (token?: string) =>
      (await (
        await withUsers(asUser(token, new Request("http://x/admin/schema.json")))
      )?.json()) as AdminSchema;

    expect((await schemaFor("ada")).users?.path).toBe("/admin/api/users");
    // Stripped from the shell with the collections: knowing the route exists is knowing where to aim.
    expect((await schemaFor()).users).toBeUndefined();
    expect((await schemaFor("bob")).users).toBeUndefined();
  });

  it("serves the users route beside the schema, under the admin's own path", async () => {
    const withUsers = createAdminHandler(
      { collections },
      { assets: bundle, auth: { auth: { ...sessions, users: usersApi } } },
    );

    const listed = await withUsers(
      asUser("ada", new Request("http://x/admin/api/users")),
    );
    expect(listed?.status).toBe(200);
    expect(await listed?.json()).toEqual([
      { id: "u1", email: "ada@example.com", createdAt: 1 },
    ]);
    // The bundle answers everything else under `/admin`, so order matters as much as it does for
    // `schema.json`: a users request must not come back as `index.html`.
    expect(listed?.headers.get("content-type")).toContain("application/json");
  });

  it("leaves the users screens out when the host's auth offers no administration", async () => {
    const plain = createAdminHandler(
      { collections },
      { assets: bundle, auth: { auth: sessions } },
    );
    const schema = (await (
      await plain(asUser("ada", new Request("http://x/admin/schema.json")))
    )?.json()) as AdminSchema;

    expect(schema.users).toBeUndefined();
    // And the route is not merely unadvertised — it isn't there.
    const response = await plain(asUser("ada", new Request("http://x/admin/api/users")));
    expect(response?.headers.get("content-type")).toContain("text/html");
  });
});
