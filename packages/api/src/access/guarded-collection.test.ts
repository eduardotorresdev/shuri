import type { AccessContext, CollectionSchema } from "@shuri/core";
import { RecordNotFoundError } from "@shuri/store";
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeCollectionStore } from "../collections/test-support.js";
import {
  publicCollection,
  type PublicCollection,
} from "../visibility/public-collection.js";
import { ForbiddenError, UnauthenticatedError } from "./errors.js";
import { guardedCollection } from "./guarded-collection.js";
import { ANONYMOUS } from "./principal.js";

const posts: CollectionSchema = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  access: {
    list: (ctx) => (ctx.user ? { author: { op: "eq", value: ctx.user.id } } : false),
    view: (ctx) => (ctx.user ? { author: { op: "eq", value: ctx.user.id } } : false),
    update: (ctx) => (ctx.user ? { author: { op: "eq", value: ctx.user.id } } : false),
    delete: (ctx) => (ctx.user ? { author: { op: "eq", value: ctx.user.id } } : false),
  },
  fields: [
    { type: "text", name: "title", required: true },
    { type: "text", name: "author", required: true },
  ],
};

const anonymous: AccessContext = { principal: ANONYMOUS };
const ada: AccessContext = {
  principal: { kind: "user", user: { id: "ada" } },
  user: { id: "ada" },
};

let store: ReturnType<typeof createFakeCollectionStore>;
let mine: string;
let theirs: string;

beforeEach(async () => {
  store = createFakeCollectionStore(posts);
  mine = (await store.insert({ title: "Mine", author: "ada" })).id;
  theirs = (await store.insert({ title: "Theirs", author: "bob" })).id;
});

function guarded(ctx: AccessContext): PublicCollection {
  return guardedCollection(publicCollection(store, {}), posts, ctx);
}

describe("guardedCollection", () => {
  it("answers 401 to anonymous on every operation", async () => {
    const collection = guarded(anonymous);
    await expect(collection.findMany()).rejects.toThrow(UnauthenticatedError);
    await expect(collection.get(mine)).rejects.toThrow(UnauthenticatedError);
    await expect(collection.insert({ title: "x", author: "a" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(collection.update(mine, { title: "x" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(collection.delete(mine)).rejects.toThrow(UnauthenticatedError);
  });

  it("merges the rule's Where into the list query", async () => {
    const seen: unknown[] = [];
    const spy: PublicCollection = {
      ...publicCollection(store, {}),
      async findMany(query) {
        seen.push(query);
        return [];
      },
    };
    await guardedCollection(spy, posts, ada).findMany({
      where: { title: { op: "contains", value: "M" } },
      limit: 5,
    });
    expect(seen).toEqual([
      {
        limit: 5,
        where: {
          title: { op: "contains", value: "M" },
          author: { op: "eq", value: "ada" },
        },
      },
    ]);
  });

  it("hides a record the Where excludes behind the same 404 as a missing id", async () => {
    const collection = guarded(ada);
    expect((await collection.get(mine)).title).toBe("Mine");

    const excluded = await collection.get(theirs).catch((error: unknown) => error);
    const missing = await collection.get("nope").catch((error: unknown) => error);
    expect(excluded).toBeInstanceOf(RecordNotFoundError);
    expect(missing).toBeInstanceOf(RecordNotFoundError);
    expect((excluded as Error).message).toBe(
      'Record "' + theirs + '" not found in collection "posts"',
    );
  });

  it("checks the pre-image on update and delete, and leaves the excluded row untouched", async () => {
    const collection = guarded(ada);
    await expect(collection.update(theirs, { author: "ada" })).rejects.toThrow(
      RecordNotFoundError,
    );
    await expect(collection.delete(theirs)).rejects.toThrow(RecordNotFoundError);
    expect(await store.get(theirs)).toMatchObject({ author: "bob" });

    expect((await collection.update(mine, { title: "Edited" })).title).toBe("Edited");
    await collection.delete(mine);
    expect(await store.findOne(mine)).toBeUndefined();
  });

  it("allows an op with no rule to a user, and denies it to a client without the scope", async () => {
    const created = await guarded(ada).insert({ title: "New", author: "ada" });
    expect(created.id).toBeTruthy();

    const bot: AccessContext = {
      principal: {
        kind: "client",
        client: { id: "c1", name: "bot" },
        scopes: new Set(["posts:list"]),
      },
    };
    await expect(guarded(bot).insert({ title: "x", author: "a" })).rejects.toThrow(
      ForbiddenError,
    );
  });
});
