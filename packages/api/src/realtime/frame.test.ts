import type { StoreEvent } from "@shuri/store";
import { describe, expect, it } from "vitest";
import { toEventFrame } from "./frame.js";

describe("toEventFrame", () => {
  it("puts the event type on the event line and the rest of the event, minus scope, in data", () => {
    const event: StoreEvent = {
      scope: "collection",
      type: "create",
      collection: "services",
      id: "1",
      record: { id: "1", name: "Haircut" },
    };

    expect(toEventFrame(event)).toBe(
      'event: create\ndata: {"collection":"services","id":"1","record":{"id":"1","name":"Haircut"}}\n\n',
    );
  });

  it("formats a delete with no record, and a global update", () => {
    expect(
      toEventFrame({
        scope: "collection",
        type: "delete",
        collection: "services",
        id: "1",
      }),
    ).toBe('event: delete\ndata: {"collection":"services","id":"1"}\n\n');

    expect(
      toEventFrame({
        scope: "global",
        type: "update",
        global: "site",
        record: { name: "Acme" },
      }),
    ).toBe('event: update\ndata: {"global":"site","record":{"name":"Acme"}}\n\n');
  });

  it("keeps a record containing newlines on a single data line", () => {
    const frame = toEventFrame({
      scope: "collection",
      type: "update",
      collection: "services",
      id: "1",
      record: { id: "1", body: "first\nsecond" },
    });

    expect(frame.split("\n")).toHaveLength(4);
    expect(frame).toContain('"body":"first\\nsecond"');
  });
});
