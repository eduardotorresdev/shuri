import { describe, expect, it } from "vitest";
import { createApiHandler } from "./handler.js";
import { createFakeApp } from "./test-support.js";

describe("createApiHandler", () => {
  it("dispatches GET on the collection path to findMany", async () => {
    const handler = createApiHandler(createFakeApp());
    const response = await handler(new Request("http://localhost/collections/services"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("dispatches POST on the collection path to insert, returning 201", async () => {
    const handler = createApiHandler(createFakeApp());
    const response = await handler(
      new Request("http://localhost/collections/services", { method: "POST", body: JSON.stringify({ name: "Haircut" }) }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "Haircut" });
  });

  it("dispatches GET/PATCH/DELETE on the record path", async () => {
    const handler = createApiHandler(createFakeApp());
    const inserted = await handler(
      new Request("http://localhost/collections/services", { method: "POST", body: JSON.stringify({ name: "Haircut" }) }),
    ).then((response) => response.json() as Promise<{ id: string }>);

    const get = await handler(new Request(`http://localhost/collections/services/${inserted.id}`));
    expect(get.status).toBe(200);

    const patch = await handler(
      new Request(`http://localhost/collections/services/${inserted.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Massage" }),
      }),
    );
    expect(await patch.json()).toMatchObject({ name: "Massage" });

    const del = await handler(new Request(`http://localhost/collections/services/${inserted.id}`, { method: "DELETE" }));
    expect(del.status).toBe(204);
  });

  it("returns 404 for a path outside basePath", async () => {
    const handler = createApiHandler(createFakeApp());
    const response = await handler(new Request("http://localhost/other"));
    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown collection slug", async () => {
    const handler = createApiHandler(createFakeApp());
    const response = await handler(new Request("http://localhost/collections/unknown"));
    expect(response.status).toBe(404);
  });

  it("returns 405 for an unsupported method", async () => {
    const handler = createApiHandler(createFakeApp());
    const response = await handler(new Request("http://localhost/collections/services", { method: "PUT" }));
    expect(response.status).toBe(405);
  });

  it("returns 400 for an invalid JSON body", async () => {
    const handler = createApiHandler(createFakeApp());
    const response = await handler(
      new Request("http://localhost/collections/services", { method: "POST", body: "not json" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid query param", async () => {
    const handler = createApiHandler(createFakeApp());
    const response = await handler(new Request("http://localhost/collections/services?limit=-1"));
    expect(response.status).toBe(400);
  });

  it("respects a custom basePath", async () => {
    const handler = createApiHandler(createFakeApp(), { basePath: "/api" });
    const response = await handler(new Request("http://localhost/api/services"));
    expect(response.status).toBe(200);
  });

  it("rethrows errors it doesn't recognize, leaving them for the hosting engine", async () => {
    const collection = createFakeApp();
    collection.store.collection = () => {
      throw new Error("boom");
    };
    const handler = createApiHandler(collection);
    await expect(handler(new Request("http://localhost/collections/services"))).rejects.toThrow("boom");
  });
});
