import { createCore } from "@shuri/core";
import { createStore, type Store } from "@shuri/store";
import { createMemoryAdapter } from "@shuri/store-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRealtimeHandler } from "../handler.js";
import { readEvents, servicesSchema, siteSettingsSchema } from "../test-support.js";

/**
 * End-to-end coverage across `@shuri/core`, `@shuri/store` and `@shuri/store-memory`: writes go
 * through a real `Store` on a real (in-memory) adapter, and come back out as SSE frames over a
 * `Request`/`Response` pair — one bus serving both surfaces. Built without `@shuri/sdk` (which
 * depends on this package) to avoid a cycle, exactly like `collections/test/api.test.ts`.
 *
 * No HTTP server is needed because `eventStreamResponse` subscribes synchronously while building
 * the response: by the time `await handler(request)` resolves, the stream is live, so a test can
 * start reading, then write, then await the frames.
 */
let store: Store;
let handler: (request: Request) => Promise<Response | undefined>;
let controller: AbortController;

beforeEach(() => {
  store = createStore(
    createCore({ collections: [servicesSchema], globals: [siteSettingsSchema] }),
    createMemoryAdapter(),
  );
  handler = createRealtimeHandler({ store }, { heartbeatMs: 0 });
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
});

async function openStream(query = ""): Promise<Response> {
  const response = await handler(
    new Request(`http://localhost/events${query}`, { signal: controller.signal }),
  );
  if (!response) throw new Error("expected the realtime handler to answer");
  return response;
}

describe("event stream over a real Store", () => {
  it("streams a record's whole lifecycle, in order", async () => {
    const response = await openStream("?collection=services");
    const frames = readEvents(response, 3);

    const record = await store.collection("services").insert({ name: "Haircut" });
    await store.collection("services").update(record.id, { name: "Trim" });
    await store.collection("services").delete(record.id);

    expect(await frames).toEqual([
      {
        event: "create",
        data: { collection: "services", id: record.id, record },
      },
      {
        event: "update",
        data: {
          collection: "services",
          id: record.id,
          record: { id: record.id, name: "Trim" },
        },
      },
      { event: "delete", data: { collection: "services", id: record.id } },
    ]);
  });

  it("streams only the selected record", async () => {
    const watched = await store.collection("services").insert({ name: "Haircut" });
    const response = await openStream(`?id=${watched.id}`);
    const frames = readEvents(response, 1);

    const other = await store.collection("services").insert({ name: "Massage" });
    await store.collection("services").update(other.id, { name: "Deep massage" });
    await store.collection("services").update(watched.id, { name: "Trim" });

    expect(await frames).toEqual([
      {
        event: "update",
        data: {
          collection: "services",
          id: watched.id,
          record: { id: watched.id, name: "Trim" },
        },
      },
    ]);
  });

  it("streams a global's updates", async () => {
    const response = await openStream("?global=site");
    const frames = readEvents(response, 1);

    await store.collection("services").insert({ name: "Haircut" });
    await store.global("site").update({ name: "Acme" });

    expect(await frames).toEqual([
      { event: "update", data: { global: "site", record: { name: "Acme" } } },
    ]);
  });

  it("delivers nothing once the request is aborted", async () => {
    const response = await openStream();
    const frames = readEvents(response, 2);
    await store.collection("services").insert({ name: "Haircut" });

    controller.abort();
    await store.global("site").update({ name: "Acme" });

    expect(await frames).toHaveLength(1);
  });
});
