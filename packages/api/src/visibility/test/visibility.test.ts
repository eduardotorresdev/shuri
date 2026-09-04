import { createCore, type CollectionSchema, type GlobalSchema } from "@shuri/core";
import { createStore, type Store } from "@shuri/store";
import { createMemoryAdapter } from "@shuri/store-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../../handler.js";
import { readEvents } from "../../realtime/test-support.js";
import type { OpenApiDocument } from "../../docs/openapi.js";

/**
 * End-to-end coverage of what `hidden` and `internal` actually promise, through the composed
 * handler over a real `Store` on a real (in-memory) adapter: the HTTP surface filters, the
 * programmatic surface does not.
 */
const users: CollectionSchema = {
  slug: "users",
  title: "Users",
  singular: "User",
  plural: "Users",
  fields: [
    { type: "email", name: "email", required: true },
    { type: "text", name: "passwordHash", hidden: true },
  ],
};

const sessions: CollectionSchema = {
  slug: "_sessions",
  title: "Sessions",
  singular: "Session",
  plural: "Sessions",
  internal: true,
  fields: [{ type: "text", name: "tokenHash", required: true }],
};

const secrets: GlobalSchema = {
  slug: "secrets",
  title: "Secrets",
  category: { title: "Geral" },
  fields: [
    { type: "text", name: "name" },
    { type: "text", name: "apiKey", hidden: true },
  ],
};

const collections: CollectionSchema[] = [users, sessions];
const globals: GlobalSchema[] = [secrets];

let store: Store;
let handler: (request: Request) => Promise<Response>;
let controller: AbortController;

beforeEach(() => {
  const core = createCore({ collections, globals });
  store = createStore(core, createMemoryAdapter());
  handler = createHandler({ core, store }, { realtime: { heartbeatMs: 0 } });
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
});

function insertUser(): Promise<{ id: string }> {
  return store
    .collection("users")
    .insert({ email: "a@b.com", passwordHash: "$pbkdf2$secret" });
}

describe("hidden fields", () => {
  it("never leave over HTTP, while the store keeps returning them", async () => {
    const stored = await insertUser();

    const list = await handler(new Request("http://localhost/collections/users"));
    const one = await handler(
      new Request(`http://localhost/collections/users/${stored.id}`),
    );

    expect(await list.json()).toEqual([{ id: stored.id, email: "a@b.com" }]);
    expect(await one.json()).toEqual({ id: stored.id, email: "a@b.com" });
    expect(await store.collection("users").get(stored.id)).toMatchObject({
      passwordHash: "$pbkdf2$secret",
    });
  });

  it("cannot be written over HTTP: a silent drop would be an auth bypass with no log line", async () => {
    const stored = await insertUser();

    const response = await handler(
      new Request(`http://localhost/collections/users/${stored.id}`, {
        method: "PATCH",
        body: JSON.stringify({ passwordHash: "chosen-by-attacker" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await store.collection("users").get(stored.id)).toMatchObject({
      passwordHash: "$pbkdf2$secret",
    });
  });

  it("cannot be filtered on, which would read them back one guess at a time", async () => {
    const where = encodeURIComponent(
      JSON.stringify({ passwordHash: { op: "contains", value: "$" } }),
    );
    const response = await handler(
      new Request(`http://localhost/collections/users?where=${where}`),
    );
    expect(response.status).toBe(400);
  });

  it("are stripped from a global's responses too", async () => {
    await store.global("secrets").update({ name: "Shuri", apiKey: "k" });
    const response = await handler(new Request("http://localhost/globals/secrets"));
    expect(await response.json()).toEqual({ name: "Shuri" });
  });
});

describe("internal collections", () => {
  it("answer exactly as a slug that was never declared", async () => {
    const internal = await handler(new Request("http://localhost/collections/_sessions"));
    const unknown = await handler(new Request("http://localhost/collections/nope"));

    expect(internal.status).toBe(unknown.status);
    expect(await internal.json()).toEqual({ error: 'Unknown collection "_sessions"' });
    expect(await unknown.json()).toEqual({ error: 'Unknown collection "nope"' });
  });

  it("stay fully usable programmatically", async () => {
    const session = await store.collection("_sessions").insert({ tokenHash: "abc" });
    expect(await store.collection("_sessions").get(session.id)).toMatchObject({
      tokenHash: "abc",
    });
  });
});

describe("the event stream", () => {
  it("drops internal collections and strips hidden fields", async () => {
    const response = await handler(
      new Request("http://localhost/events", { signal: controller.signal }),
    );
    const frames = readEvents(response, 1);

    // Written first: if the first frame that arrives is the `users` one, the `_sessions` write
    // produced none. Asserting absence in a stream any other way is a race.
    await store.collection("_sessions").insert({ tokenHash: "abc" });
    const user = await insertUser();

    expect(await frames).toEqual([
      {
        event: "create",
        data: {
          collection: "users",
          id: user.id,
          record: { id: user.id, email: "a@b.com" },
        },
      },
    ]);
  });

  it("404s a selection naming an internal collection", async () => {
    const response = await handler(
      new Request("http://localhost/events?collection=_sessions", {
        signal: controller.signal,
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe("the OpenAPI document", () => {
  it("describes only what is actually served", async () => {
    const response = await handler(new Request("http://localhost/openapi.json"));
    const document = (await response.json()) as OpenApiDocument;

    expect(Object.keys(document.paths)).toContain("/collections/users");
    expect(Object.keys(document.paths)).not.toContain("/collections/_sessions");
    expect(document.components.schemas["_sessions"]).toBeUndefined();
    expect(document.components.schemas["users"].properties).toEqual({
      id: { type: "string", readOnly: true },
      email: { type: "string", format: "email" },
    });
    expect(document.components.schemas["secrets"].properties).toEqual({
      name: { type: "string", minLength: undefined, maxLength: undefined },
    });
  });
});
