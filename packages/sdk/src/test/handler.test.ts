import { createMemoryAdapter } from "@shuri/store-memory";
import { beforeEach, describe, expect, it } from "vitest";
import { create } from "../create.js";

/**
 * End-to-end coverage of `app.handler`: `create()` is the single source of truth serving both the
 * SDK (`app.collections`) and the HTTP API (`app.handler`, wired from `@shuri/api` internally) off
 * the same `Store`. Unit tests for `create()`'s own wiring live in `create.test.ts`; HTTP-layer
 * behavior (routing, error mapping, query/body validation, ...) is covered in `@shuri/api`.
 */
const collections = [
  {
    slug: "services",
    title: "Services",
    singular: "Service",
    plural: "Services",
    fields: [{ type: "text", name: "name", required: true }],
  },
] as const;

let handler: (request: Request) => Promise<Response>;

beforeEach(() => {
  const app = create({ collections, adapter: createMemoryAdapter() });
  handler = app.handler;
});

describe("app.handler", () => {
  it("serves collections declared on the app over HTTP", async () => {
    const insertResponse = await handler(
      new Request("http://localhost/collections/services", { method: "POST", body: JSON.stringify({ name: "Haircut" }) }),
    );
    expect(insertResponse.status).toBe(201);

    const listResponse = await handler(new Request("http://localhost/collections/services"));
    expect(await listResponse.json()).toMatchObject([{ name: "Haircut" }]);
  });

  it("reflects a record inserted through app.collections when read back over HTTP", async () => {
    const app = create({ collections, adapter: createMemoryAdapter() });
    const inserted = await app.collections.services.insert({ name: "Massage" });

    const response = await app.handler(new Request(`http://localhost/collections/services/${inserted.id}`));
    expect(await response.json()).toEqual(inserted);
  });

  it("honors the api.basePath option passed to create()", async () => {
    const app = create({ collections, adapter: createMemoryAdapter(), api: { basePath: "/api" } });
    const response = await app.handler(
      new Request("http://localhost/api/services", { method: "POST", body: JSON.stringify({ name: "Haircut" }) }),
    );
    expect(response.status).toBe(201);
  });
});
