import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { createAdminHandler } from "../handler.js";
import { everythingUnderApi } from "../auth/protect.js";
import { asUser, stubSessions } from "../auth/test-support.js";
import { loadAdminAssets } from "../assets/load.js";
import type { AdminAssets } from "../assets/types.js";
import type { AdminSchema } from "../../shared/schema.js";

const collections: CollectionSchema[] = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [
      { type: "text", name: "title", required: true },
      { type: "text", name: "internalNote", hidden: true },
      { type: "relation", name: "author", collection: "authors" },
    ],
  },
  {
    slug: "_sessions",
    title: "Sessions",
    singular: "Session",
    plural: "Sessions",
    internal: true,
    fields: [{ type: "text", name: "tokenHash" }],
  },
];

const globals: GlobalSchema[] = [
  {
    slug: "site",
    title: "Site",
    category: { title: "Geral" },
    fields: [{ type: "text", name: "name" }],
  },
];

/** The REST paths `createAdminHandler` advertises when the host overrides none of them. */
const DEFAULT_API = {
  collections: "/collections",
  globals: "/globals",
  events: "/events",
};

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

describe("createAdminHandler", () => {
  const handler = createAdminHandler({ collections, globals }, { assets: bundle });

  it("serves the schema the admin draws itself from", async () => {
    const response = await handler(new Request("http://x/admin/schema.json"));
    const schema = (await response?.json()) as AdminSchema;

    expect(schema.collections.map((entry) => entry.slug)).toEqual(["posts"]);
    expect(schema.globals.map((entry) => entry.slug)).toEqual(["site"]);
  });

  it("keeps hidden fields and internal collections out of it, as the REST routes do", async () => {
    const response = await handler(new Request("http://x/admin/schema.json"));
    const schema = (await response?.json()) as AdminSchema;

    expect(schema.collections[0]?.fields.map((field) => field.name)).toEqual([
      "title",
      "author",
    ]);
    expect(JSON.stringify(schema)).not.toContain("_sessions");
  });

  it("serves the app for the admin's own paths", async () => {
    const root = await handler(new Request("http://x/admin"));
    const deep = await handler(new Request("http://x/admin/collections/posts/abc"));

    expect(await root?.text()).toContain("admin");
    expect(await deep?.text()).toContain("admin");
  });

  it("answers the schema route rather than the fallback, despite both matching", async () => {
    const response = await handler(new Request("http://x/admin/schema.json"));

    expect(response?.headers.get("content-type")).toBe("application/json");
  });

  it("declines everything outside the base path, so the REST routes still get theirs", async () => {
    expect(await handler(new Request("http://x/collections/posts"))).toBeUndefined();
    expect(await handler(new Request("http://x/"))).toBeUndefined();
  });

  it("serves the schema only when asked to, for a host that runs the UI itself", async () => {
    const headless = createAdminHandler({ collections }, { assets: false });

    expect(await headless(new Request("http://x/admin/schema.json"))).toBeDefined();
    expect(await headless(new Request("http://x/admin"))).toBeUndefined();
  });

  it("moves with basePath, schema route included", async () => {
    const moved = createAdminHandler(
      { collections },
      { basePath: "/cms", assets: bundle },
    );

    expect(await moved(new Request("http://x/cms/schema.json"))).toBeDefined();
    expect(await moved(new Request("http://x/admin/schema.json"))).toBeUndefined();
  });
});

describe("loadAdminAssets", () => {
  it("reads this package's own build output", () => {
    const assets = loadAdminAssets();

    expect(assets.get("index.html")?.contentType).toBe("text/html; charset=utf-8");
    expect([...assets.keys()].some((key) => key.startsWith("_app/immutable/"))).toBe(
      true,
    );
  });

  it("marks the hashed files immutable and the entry document not", () => {
    const assets = loadAdminAssets();
    const hashed = [...assets].find(([key]) => key.startsWith("_app/immutable/"));

    expect(hashed?.[1].immutable).toBe(true);
    expect(assets.get("index.html")?.immutable).toBe(false);
  });

  it("says which command is missing when there is no build to read", () => {
    expect(() => loadAdminAssets("/nonexistent/build")).toThrow(
      /pnpm --filter @shuri\/ui build/,
    );
  });
});

describe("createAdminHandler with auth", () => {
  const sessions = stubSessions({
    ada: { id: "u1", email: "ada@example.com", role: "editor" },
    bob: { id: "u2", email: "bob@example.com", role: "reader" },
  });
  const handler = createAdminHandler(
    { collections, globals },
    { assets: bundle, auth: { auth: sessions } },
  );

  const schemaOf = async (token?: string): Promise<AdminSchema> => {
    const response = await handler(
      asUser(token, new Request("http://x/admin/schema.json")),
    );
    return (await response?.json()) as AdminSchema;
  };

  it("serves the app to anyone, so there is something to sign in with", async () => {
    const response = await handler(new Request("http://x/admin"));

    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain("admin");
  });

  it("tells a signed-out visitor where to sign in and nothing more", async () => {
    const schema = await schemaOf();

    expect(schema.auth?.basePath).toBe("/api/auth");
    expect(schema.viewer).toEqual({ status: "anonymous" });
    expect(schema.collections).toEqual([]);
  });

  it("hands the whole schema to a signed-in one", async () => {
    const schema = await schemaOf("ada");

    expect(schema.viewer?.status).toBe("allowed");
    expect(schema.collections.map((entry) => entry.slug)).toEqual(["posts"]);
  });

  it("refuses an anonymous write to the collections the admin edits", async () => {
    const response = await handler(
      new Request("http://x/collections/posts", { method: "POST", body: "{}" }),
    );

    expect(response?.status).toBe(401);
  });

  it("refuses an anonymous write to a global too", async () => {
    const response = await handler(
      new Request("http://x/globals/site", { method: "PATCH", body: "{}" }),
    );

    expect(response?.status).toBe(401);
  });

  it("lets a signed-in write fall through to the routes that perform it", async () => {
    const response = await handler(
      asUser(
        "ada",
        new Request("http://x/collections/posts", { method: "POST", body: "{}" }),
      ),
    );

    expect(response).toBeUndefined();
  });

  it("leaves reads open by default, so the public API keeps working", async () => {
    expect(await handler(new Request("http://x/collections/posts"))).toBeUndefined();
  });

  it("never blocks the login route, which has no session to offer yet", async () => {
    expect(
      await handler(new Request("http://x/auth/login", { method: "POST" })),
    ).toBeUndefined();
  });

  it("distinguishes a user the host refuses from one who never signed in", async () => {
    const strict = createAdminHandler(
      { collections, globals },
      {
        assets: bundle,
        auth: { auth: sessions, authorize: (s) => s.user["role"] === "editor" },
      },
    );
    const write = (token?: string) =>
      strict(
        asUser(token, new Request("http://x/collections/posts", { method: "POST" })),
      );

    expect((await write())?.status).toBe(401);
    expect((await write("bob"))?.status).toBe(403);
    expect(await write("ada")).toBeUndefined();
  });

  it("closes reads as well when the host asks, at the cost of a public API", async () => {
    const closed = createAdminHandler(
      { collections },
      {
        assets: bundle,
        auth: { auth: sessions, protect: everythingUnderApi(DEFAULT_API) },
      },
    );

    expect((await closed(new Request("http://x/collections/posts")))?.status).toBe(401);
    expect(
      await closed(asUser("ada", new Request("http://x/collections/posts"))),
    ).toBeUndefined();
  });

  it("leaves an app with no auth exactly as open as it was", async () => {
    const open = createAdminHandler({ collections }, { assets: bundle });
    const schema = (await (
      await open(new Request("http://x/admin/schema.json"))
    )?.json()) as AdminSchema;

    expect(schema.auth).toBeUndefined();
    expect(schema.viewer).toBeUndefined();
    expect(schema.collections).toHaveLength(1);
    expect(
      await open(new Request("http://x/collections/posts", { method: "POST" })),
    ).toBeUndefined();
  });
});
