import type { StoreEvent } from "@shuri/store";
import { describe, expect, it } from "vitest";
import { createFakeRealtimeApp } from "../realtime/test-support.js";
import { publicEvent } from "./public-event.js";
import { accountsSchema, secretsSchema, sessionsSchema } from "./test-support.js";

function store() {
  return createFakeRealtimeApp([accountsSchema, sessionsSchema], [secretsSchema]).store;
}

const created: StoreEvent = {
  scope: "collection",
  type: "create",
  collection: "accounts",
  id: "1",
  record: { id: "1", email: "a@b.com", passwordHash: "secret" },
};

describe("publicEvent", () => {
  it("strips hidden fields from a collection event's record", () => {
    expect(publicEvent(store(), created)).toEqual({
      ...created,
      record: { id: "1", email: "a@b.com" },
    });
  });

  it("leaves the original event untouched, since every other subscriber shares it", () => {
    const event = { ...created, record: { ...created.record } };
    publicEvent(store(), event);
    expect(event.record).toHaveProperty("passwordHash", "secret");
  });

  it("drops every event of an internal collection", () => {
    expect(
      publicEvent(store(), {
        scope: "collection",
        type: "create",
        collection: "_sessions",
        id: "1",
        record: { id: "1", tokenHash: "abc" },
      }),
    ).toBeUndefined();
    expect(
      publicEvent(store(), {
        scope: "collection",
        type: "delete",
        collection: "_sessions",
        id: "1",
      }),
    ).toBeUndefined();
  });

  it("passes a delete event through: it carries no record to redact", () => {
    const event: StoreEvent = {
      scope: "collection",
      type: "delete",
      collection: "accounts",
      id: "1",
    };
    expect(publicEvent(store(), event)).toBe(event);
  });

  it("strips hidden fields from a global event's record", () => {
    expect(
      publicEvent(store(), {
        scope: "global",
        type: "update",
        global: "secrets",
        record: { name: "Shuri", apiKey: "k" },
      }),
    ).toEqual({
      scope: "global",
      type: "update",
      global: "secrets",
      record: { name: "Shuri" },
    });
  });

  it("fails closed for a slug the store can't resolve", () => {
    expect(
      publicEvent(store(), {
        scope: "collection",
        type: "create",
        collection: "gone",
        id: "1",
        record: { id: "1" },
      }),
    ).toBeUndefined();
  });
});
