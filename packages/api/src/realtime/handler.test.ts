import type { StoreEvent } from "@shuri/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRealtimeHandler, type RealtimeApp } from "./handler.js";
import { createFakeRealtimeApp, readEvents } from "./test-support.js";

const created: StoreEvent = {
  scope: "collection",
  type: "create",
  collection: "services",
  id: "1",
  record: { id: "1", name: "Haircut" },
};
const siteUpdated: StoreEvent = {
  scope: "global",
  type: "update",
  global: "site",
  record: { name: "Acme" },
};

let app: RealtimeApp;
let handler: (request: Request) => Promise<Response | undefined>;
let controller: AbortController;

beforeEach(() => {
  app = createFakeRealtimeApp();
  // Every test disables the heartbeat: an interval left running holds the event loop open.
  handler = createRealtimeHandler(app, { heartbeatMs: 0 });
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
});

function streamRequest(query = ""): Request {
  return new Request(`http://localhost/events${query}`, { signal: controller.signal });
}

describe("createRealtimeHandler", () => {
  it("falls through for a request outside the base path", async () => {
    expect(
      await handler(new Request("http://localhost/collections/services")),
    ).toBeUndefined();
  });

  it("rejects a method other than GET", async () => {
    const response = await handler(
      new Request("http://localhost/events", { method: "POST" }),
    );
    expect(response?.status).toBe(405);
  });

  it("rejects an invalid selection with a 400 carrying the issues", async () => {
    const response = await handler(streamRequest("?events=nope"));

    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({
      issues: [{ path: "query.events.0" }],
    });
  });

  it("rejects a selection naming an undeclared slug with a 404", async () => {
    expect((await handler(streamRequest("?collection=nope")))?.status).toBe(404);
    expect((await handler(streamRequest("?global=nope")))?.status).toBe(404);
  });

  it("opens an event stream and delivers every event when nothing is selected", async () => {
    const response = await handler(streamRequest());

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/event-stream");

    const frames = readEvents(response as Response, 2);
    app.store.events.emit(created);
    app.store.events.emit(siteUpdated);

    expect(await frames).toEqual([
      {
        event: "create",
        data: { collection: "services", id: "1", record: created.record },
      },
      { event: "update", data: { global: "site", record: { name: "Acme" } } },
    ]);
  });

  it("filters events server-side, per the selection", async () => {
    const response = await handler(streamRequest("?global=site"));

    const frames = readEvents(response as Response, 1);
    app.store.events.emit(created);
    app.store.events.emit(siteUpdated);

    expect(await frames).toEqual([
      { event: "update", data: { global: "site", record: { name: "Acme" } } },
    ]);
  });

  it("closes the stream and unsubscribes when the request is aborted", async () => {
    const response = await handler(streamRequest());
    const frames = readEvents(response as Response, 2);
    app.store.events.emit(created);

    controller.abort();
    app.store.events.emit(siteUpdated);

    // Only the event emitted before the abort made it through, and the read ended on close.
    expect(await frames).toEqual([
      {
        event: "create",
        data: { collection: "services", id: "1", record: created.record },
      },
    ]);
  });
});
