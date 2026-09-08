import type { AccessContext, CollectionSchema, GlobalSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { createFakeRealtimeApp } from "../realtime/test-support.js";
import { ForbiddenError, UnauthenticatedError } from "./errors.js";
import { createEventGate } from "./event-gate.js";
import { ANONYMOUS } from "./principal.js";

let evaluations = 0;
const posts: CollectionSchema = {
  slug: "posts",
  title: "Posts",
  singular: "Post",
  plural: "Posts",
  access: {
    list: (ctx) => {
      evaluations += 1;
      return ctx.user ? { author: { op: "eq", value: ctx.user.id } } : false;
    },
  },
  fields: [{ type: "text", name: "author" }],
};
const notes: CollectionSchema = { ...posts, slug: "notes", access: { list: true } };
const site: GlobalSchema = {
  slug: "site",
  title: "Site",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name" }],
};

const ada: AccessContext = {
  principal: { kind: "user", user: { id: "ada" } },
  user: { id: "ada" },
};

describe("createEventGate", () => {
  const { store } = createFakeRealtimeApp([posts, notes], [site]);

  it("refuses an explicit selection the principal may not read, in the right status", async () => {
    await expect(
      createEventGate(store, { principal: ANONYMOUS }).assertSelectable({
        global: ["site"],
      }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      createEventGate(store, {
        principal: { kind: "client", client: { id: "c", name: "c" }, scopes: new Set() },
      }).assertSelectable({ collection: ["notes"] }),
    ).rejects.toThrow(ForbiddenError);
    await createEventGate(store, { principal: ANONYMOUS }).assertSelectable({
      collection: ["notes"],
    });
  });

  it("admits per the rule, checking a Where against the record and dropping deletes under it", async () => {
    const gate = createEventGate(store, ada);
    evaluations = 0;

    const mine = {
      scope: "collection",
      type: "create",
      collection: "posts",
      id: "1",
      record: { id: "1", author: "ada" },
    } as const;
    const theirs = { ...mine, id: "2", record: { id: "2", author: "bob" } } as const;
    const deleted = {
      scope: "collection",
      type: "delete",
      collection: "posts",
      id: "1",
    } as const;

    expect(await gate.admits(mine)).toBe(true);
    expect(await gate.admits(theirs)).toBe(false);
    expect(await gate.admits(deleted)).toBe(false);
    expect(
      await gate.admits({ scope: "global", type: "update", global: "site", record: {} }),
    ).toBe(true);
    expect(evaluations).toBe(1);
  });

  it("denies a global with no rule to anonymous", async () => {
    const gate = createEventGate(store, { principal: ANONYMOUS });
    expect(
      await gate.admits({ scope: "global", type: "update", global: "site", record: {} }),
    ).toBe(false);
  });
});
