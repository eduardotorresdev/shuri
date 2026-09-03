import type { StoreEvent } from "@shuri/store";
import { describe, expect, it } from "vitest";
import { matchesSelection } from "./filter.js";

const created: StoreEvent = {
  scope: "collection",
  type: "create",
  collection: "services",
  id: "1",
  record: { id: "1", name: "Haircut" },
};
const deleted: StoreEvent = {
  scope: "collection",
  type: "delete",
  collection: "authors",
  id: "2",
};
const globalUpdated: StoreEvent = {
  scope: "global",
  type: "update",
  global: "site",
  record: { name: "Acme" },
};

describe("matchesSelection", () => {
  it("matches every event when no selector is given", () => {
    for (const event of [created, deleted, globalUpdated]) {
      expect(matchesSelection(event, {})).toBe(true);
    }
  });

  it("selects collections by slug, leaving globals out", () => {
    const selection = { collection: ["services"] };
    expect(matchesSelection(created, selection)).toBe(true);
    expect(matchesSelection(deleted, selection)).toBe(false);
    expect(matchesSelection(globalUpdated, selection)).toBe(false);
  });

  it("selects globals by slug, leaving collections out", () => {
    const selection = { global: ["site"] };
    expect(matchesSelection(globalUpdated, selection)).toBe(true);
    expect(matchesSelection(globalUpdated, { global: ["seo"] })).toBe(false);
    expect(matchesSelection(created, selection)).toBe(false);
  });

  it("streams both scopes when both are selected", () => {
    const selection = { collection: ["services"], global: ["site"] };
    expect(matchesSelection(created, selection)).toBe(true);
    expect(matchesSelection(globalUpdated, selection)).toBe(true);
    expect(matchesSelection(deleted, selection)).toBe(false);
  });

  it("selects records by id, leaving globals out", () => {
    expect(matchesSelection(created, { id: ["1"] })).toBe(true);
    expect(matchesSelection(created, { id: ["2"] })).toBe(false);
    expect(matchesSelection(globalUpdated, { id: ["1"] })).toBe(false);
  });

  it("narrows a selected collection down to selected ids", () => {
    const selection = { collection: ["services", "authors"], id: ["2"] };
    expect(matchesSelection(deleted, selection)).toBe(true);
    expect(matchesSelection(created, selection)).toBe(false);
  });

  it("applies the event types to both scopes alike", () => {
    expect(matchesSelection(created, { events: ["create"] })).toBe(true);
    expect(matchesSelection(created, { events: ["update", "delete"] })).toBe(false);
    expect(matchesSelection(globalUpdated, { events: ["update"] })).toBe(true);
    expect(matchesSelection(globalUpdated, { events: ["create"] })).toBe(false);
  });
});
