import {
  createCore,
  type AccessContext,
  type CollectionSchema,
  type GlobalSchema,
  type Principal,
} from "@shuri/core";
import { createStore, type Store } from "@shuri/store";
import { createMemoryAdapter } from "@shuri/store-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../../handler.js";
import { readEvents } from "../../realtime/test-support.js";

/**
 * The access policy end to end, through the composed handler over a real store: anonymous, a
 * signed-in user, and a client with scopes, against collections with and without rules. The
 * principal comes off a fake `x-principal` header, so this stays independent of `@shuri/auth`.
 */
const collections: CollectionSchema[] = [];
const globals: GlobalSchema[] = [];

const mineOnly = (ctx: AccessContext) =>
  ctx.user ? { author: { op: "eq" as const, value: ctx.user.id } } : false;

const posts: CollectionSchema = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  access: { list: () => true, view: () => true, update: mineOnly, delete: mineOnly },
  fields: [
    { type: "text", name: "title", required: true },
    { type: "text", name: "author", required: true },
  ],
};

const drafts: CollectionSchema = {
  slug: "drafts",
  title: "Drafts",
  singular: "Draft",
  plural: "Drafts",
  access: { list: mineOnly },
  fields: [
    { type: "text", name: "title", required: true },
    { type: "text", name: "author", required: true },
  ],
};

const notes: CollectionSchema = {
  slug: "notes",
  title: "Notes",
  singular: "Note",
  plural: "Notes",
  fields: [{ type: "text", name: "body" }],
};

const site: GlobalSchema = {
  slug: "site",
  title: "Site",
  category: { title: "Geral" },
  access: { read: () => true },
  fields: [{ type: "text", name: "name" }],
};

const seo: GlobalSchema = {
  slug: "seo",
  title: "SEO",
  category: { title: "SEO" },
  fields: [{ type: "text", name: "title" }],
};

collections.push(posts, drafts, notes);
globals.push(site, seo);

const principals: Record<string, Principal> = {
  ada: { kind: "user", user: { id: "ada" } },
  bob: { kind: "user", user: { id: "bob" } },
  lister: {
    kind: "client",
    client: { id: "c1", name: "lister" },
    scopes: new Set(["posts:list", "notes:list"]),
  },
  broken: { kind: "user", user: { id: "x" } },
};

let store: Store;
let handler: (request: Request) => Promise<Response>;
let controller: AbortController;

beforeEach(() => {
  const core = createCore({ collections, globals });
  store = createStore(core, createMemoryAdapter());
  handler = createHandler(
    { core, store },
    {
      realtime: { heartbeatMs: 0 },
      access: {
        principal: async (request) =>
          principals[request.headers.get("x-principal") ?? ""] ?? { kind: "anonymous" },
      },
    },
  );
  controller = new AbortController();
});

afterEach(() => controller.abort());

function as(
  principal: string | undefined,
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(principal ? { "x-principal": principal } : {}),
    },
  });
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

describe("a collection with no rules", () => {
  it("answers 401 to anonymous, 200 to any user and 403 to a client without the scope", async () => {
    expect((await handler(as(undefined, "/collections/notes"))).status).toBe(401);
    expect((await handler(as("ada", "/collections/notes"))).status).toBe(200);
    expect((await handler(as("lister", "/collections/notes"))).status).toBe(200);
    expect(
      (
        await handler(
          as("lister", "/collections/notes", { method: "POST", ...json({ body: "x" }) }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler(
          as("ada", "/collections/notes", { method: "POST", ...json({ body: "x" }) }),
        )
      ).status,
    ).toBe(201);
  });

  it("decides 401 before the 400 a hidden field would earn", async () => {
    const response = await handler(
      as(undefined, "/collections/notes", { method: "POST", ...json({ id: "x" }) }),
    );
    expect(response.status).toBe(401);
  });
});

describe("Where rules", () => {
  let mine: string;
  let theirs: string;

  beforeEach(async () => {
    mine = (await store.collection("posts").insert({ title: "Mine", author: "ada" })).id;
    theirs = (await store.collection("posts").insert({ title: "Theirs", author: "bob" }))
      .id;
    await store.collection("drafts").insert({ title: "Ada's draft", author: "ada" });
    await store.collection("drafts").insert({ title: "Bob's draft", author: "bob" });
  });

  it("filter a list down to the caller's rows, on top of the client's own where", async () => {
    const list = await handler(as("ada", "/collections/drafts"));
    expect(await list.json()).toEqual([
      expect.objectContaining({ title: "Ada's draft" }),
    ]);

    const where = encodeURIComponent(
      JSON.stringify({ author: { op: "eq", value: "bob" } }),
    );
    const filtered = await handler(as("ada", `/collections/drafts?where=${where}`));
    expect(await filtered.json()).toEqual([]);
  });

  it("answer 404 for update/delete of a row the caller may not touch, and let the owner through", async () => {
    const patch = { method: "PATCH", ...json({ title: "Hijacked" }) };
    expect((await handler(as("ada", `/collections/posts/${theirs}`, patch))).status).toBe(
      404,
    );
    expect(
      (await handler(as("ada", `/collections/posts/${theirs}`, { method: "DELETE" })))
        .status,
    ).toBe(404);
    expect(await store.collection("posts").get(theirs)).toMatchObject({
      title: "Theirs",
    });

    expect((await handler(as("ada", `/collections/posts/${mine}`, patch))).status).toBe(
      200,
    );
    expect(
      (await handler(as("ada", `/collections/posts/${mine}`, { method: "DELETE" })))
        .status,
    ).toBe(204);
  });

  it("leave a public view open to anonymous", async () => {
    expect((await handler(as(undefined, `/collections/posts/${theirs}`))).status).toBe(
      200,
    );
  });
});

describe("clients", () => {
  it("are capped by their scopes even where a rule is public", async () => {
    expect((await handler(as("lister", "/collections/posts"))).status).toBe(200);
    expect((await handler(as("lister", "/collections/drafts"))).status).toBe(403);
    expect((await handler(as("lister", "/globals/site"))).status).toBe(403);
  });
});

describe("globals", () => {
  it("apply the same policy", async () => {
    expect((await handler(as(undefined, "/globals/site"))).status).toBe(200);
    expect((await handler(as(undefined, "/globals/seo"))).status).toBe(401);
    expect((await handler(as("ada", "/globals/seo"))).status).toBe(200);
    expect(
      (
        await handler(
          as(undefined, "/globals/site", { method: "PATCH", ...json({ name: "x" }) }),
        )
      ).status,
    ).toBe(401);
  });
});

describe("the event stream", () => {
  it("refuses an explicit selection the principal may not read", async () => {
    const anonymous = await handler(
      as(undefined, "/events?global=seo", { signal: controller.signal }),
    );
    expect(anonymous.status).toBe(401);
    const client = await handler(
      as("lister", "/events?collection=drafts", { signal: controller.signal }),
    );
    expect(client.status).toBe(403);
    const open = await handler(
      as(undefined, "/events?collection=posts", { signal: controller.signal }),
    );
    expect(open.status).toBe(200);
  });

  it("streams only the events the principal may list, checking a Where per record", async () => {
    const response = await handler(as("ada", "/events", { signal: controller.signal }));
    const frames = readEvents(response, 2);

    // Bob's draft is written first: if it had produced a frame, it would arrive before Ada's.
    await store.collection("drafts").insert({ title: "Bob's", author: "bob" });
    await store.collection("drafts").insert({ title: "Ada's", author: "ada" });
    await store.global("seo").update({ title: "SEO" });

    expect(await frames).toEqual([
      expect.objectContaining({
        event: "create",
        data: expect.objectContaining({
          collection: "drafts",
          record: expect.objectContaining({ title: "Ada's" }),
        }),
      }),
      expect.objectContaining({
        event: "update",
        data: expect.objectContaining({ global: "seo" }),
      }),
    ]);
  });
});
