import { createCore, type CollectionSchema } from "@shuri/core";
import { createStore, type Store } from "@shuri/store";
import { createMemoryAdapter } from "@shuri/store-memory";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiHandler } from "../handler.js";

/**
 * End-to-end coverage across `@shuri/core`, `@shuri/store` and `@shuri/store-memory`: a real
 * `Store` wired to a real (in-memory) adapter, driven only through HTTP `Request`/`Response`.
 * Builds the `Store`/adapter directly, keeping this test independent of `@shuri/sdk`'s `create()`:
 * `@shuri/sdk` depends on this package to expose `app.handler`, so a dependency back on
 * `@shuri/sdk` (even in tests) would form a cycle. The same `app.handler` scenario, built via
 * `create()`, is covered in `@shuri/sdk`'s own integration test.
 * Unit tests for the pieces this exercises live next to their source (`handler.test.ts`,
 * `query.test.ts`, `response.test.ts`, ...).
 */
const collections: CollectionSchema[] = [
  {
    slug: "services",
    title: "Services",
    singular: "Service",
    plural: "Services",
    fields: [
      { type: "text", name: "name", required: true },
      { type: "number", name: "price", kind: "float", sign: "positive" },
    ],
  },
];

let store: Store;
let handler: (request: Request) => Promise<Response>;

beforeEach(() => {
  store = createStore(createCore({ collections }), createMemoryAdapter());
  handler = createApiHandler({ store });
});

async function insertService(
  name = "Haircut",
  price = 40,
): Promise<{ id: string; name: string; price: number }> {
  const response = await handler(
    new Request("http://localhost/collections/services", {
      method: "POST",
      body: JSON.stringify({ name, price }),
    }),
  );
  return (await response.json()) as { id: string; name: string; price: number };
}

describe("api handler over a real Store", () => {
  it("inserts a record via POST and returns 201", async () => {
    const response = await handler(
      new Request("http://localhost/collections/services", {
        method: "POST",
        body: JSON.stringify({ name: "Haircut", price: 40 }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "Haircut", price: 40 });
  });

  it("lists records via GET", async () => {
    await insertService();

    const response = await handler(new Request("http://localhost/collections/services"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ name: "Haircut", price: 40 }]);
  });

  it("applies limit/offset query params", async () => {
    await insertService("Haircut", 40);
    await insertService("Massage", 80);

    const response = await handler(
      new Request("http://localhost/collections/services?limit=1&offset=1"),
    );

    expect(await response.json()).toMatchObject([{ name: "Massage" }]);
  });

  it("applies a where query param translated by the memory adapter", async () => {
    await insertService("Haircut", 40);
    await insertService("Massage", 80);

    const where = JSON.stringify({ name: { op: "eq", value: "Massage" } });
    const response = await handler(
      new Request(`http://localhost/collections/services?where=${where}`),
    );

    expect(await response.json()).toMatchObject([{ name: "Massage" }]);
  });

  it("gets a single record via GET :id", async () => {
    const inserted = await insertService();

    const response = await handler(
      new Request(`http://localhost/collections/services/${inserted.id}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(inserted);
  });

  it("returns 404 for a missing record", async () => {
    const response = await handler(
      new Request("http://localhost/collections/services/missing"),
    );
    expect(response.status).toBe(404);
  });

  it("updates a record via PATCH", async () => {
    const inserted = await insertService();

    const response = await handler(
      new Request(`http://localhost/collections/services/${inserted.id}`, {
        method: "PATCH",
        body: JSON.stringify({ price: 50 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ price: 50 });
  });

  it("deletes a record via DELETE, returning 204", async () => {
    const inserted = await insertService();

    const response = await handler(
      new Request(`http://localhost/collections/services/${inserted.id}`, {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(204);

    const getResponse = await handler(
      new Request(`http://localhost/collections/services/${inserted.id}`),
    );
    expect(getResponse.status).toBe(404);
  });

  it("returns 404 for an unknown collection slug", async () => {
    const response = await handler(new Request("http://localhost/collections/unknown"));
    expect(response.status).toBe(404);
  });

  it("returns 405 for an unsupported method", async () => {
    const response = await handler(
      new Request("http://localhost/collections/services", { method: "PUT" }),
    );
    expect(response.status).toBe(405);
  });

  it("returns 400 for an invalid JSON body", async () => {
    const response = await handler(
      new Request("http://localhost/collections/services", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid query param", async () => {
    const response = await handler(
      new Request("http://localhost/collections/services?limit=-1"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 with issues when a POST body fails the collection's field validation", async () => {
    const response = await handler(
      new Request("http://localhost/collections/services", {
        method: "POST",
        body: JSON.stringify({ price: 40 }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      issues: [{ message: '"name" is required' }],
    });
  });

  it("returns 400 when a PATCH body fails the collection's field validation, without touching the record", async () => {
    const inserted = await insertService();

    const response = await handler(
      new Request(`http://localhost/collections/services/${inserted.id}`, {
        method: "PATCH",
        body: JSON.stringify({ price: -10 }),
      }),
    );
    expect(response.status).toBe(400);

    const getResponse = await handler(
      new Request(`http://localhost/collections/services/${inserted.id}`),
    );
    expect(await getResponse.json()).toEqual(inserted);
  });

  it("respects a custom basePath", async () => {
    const customHandler = createApiHandler({ store }, { basePath: "/api" });
    const response = await customHandler(
      new Request("http://localhost/api/services", {
        method: "POST",
        body: JSON.stringify({ name: "Haircut" }),
      }),
    );
    expect(response.status).toBe(201);
  });
});
