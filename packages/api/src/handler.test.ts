import { createCore, type CollectionSchema, type GlobalSchema } from "@shuri/core";
import { createStore } from "@shuri/store";
import { createMemoryAdapter } from "@shuri/store-memory";
import { describe, expect, it } from "vitest";
import { createHandler, type CreateHandlerOptions } from "./handler.js";

const services: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [{ type: "text", name: "name", required: true }],
};

const siteSettings: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name", required: true }],
};

function buildHandler(
  options: CreateHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const core = createCore({ collections: [services], globals: [siteSettings] });
  const store = createStore(core, createMemoryAdapter());
  return createHandler({ core, store }, options);
}

describe("createHandler", () => {
  it("serves the collections routes", async () => {
    const handler = buildHandler();
    const response = await handler(
      new Request("http://localhost/collections/services", {
        method: "POST",
        body: JSON.stringify({ name: "Haircut" }),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("serves the globals routes", async () => {
    const response = await buildHandler()(new Request("http://localhost/globals/site"));
    expect(response.status).toBe(200);
  });

  it("serves the OpenAPI document and the docs page", async () => {
    const handler = buildHandler();

    const spec = await handler(new Request("http://localhost/openapi.json"));
    expect(spec.headers.get("content-type")).toBe("application/json");

    const docs = await handler(new Request("http://localhost/docs"));
    expect(docs.headers.get("content-type")).toBe("text/html");
  });

  it("serves the event stream", async () => {
    const controller = new AbortController();
    const response = await buildHandler({ realtime: { heartbeatMs: 0 } })(
      new Request("http://localhost/events", { signal: controller.signal }),
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    controller.abort();
  });

  it("answers 404 for a path no handler claims, instead of falling through", async () => {
    const response = await buildHandler()(new Request("http://localhost/nowhere"));
    expect(response.status).toBe(404);
  });

  it("documents the base paths it was configured with", async () => {
    const handler = buildHandler({
      api: { basePath: "/api" },
      globalsApi: { basePath: "/api-globals" },
      realtime: { basePath: "/stream" },
    });

    const response = await handler(new Request("http://localhost/openapi.json"));
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(Object.keys(document.paths)).toEqual([
      "/api/services",
      "/api/services/{id}",
      "/api-globals/site",
      "/stream",
    ]);
  });

  it("lets openapi options override the base paths forwarded to the document", async () => {
    const handler = buildHandler({
      api: { basePath: "/api" },
      openapi: { basePath: "/documented" },
    });

    const response = await handler(new Request("http://localhost/openapi.json"));
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(document.paths["/documented/services"]).toBeDefined();
  });
});

describe("createHandler options.handlers", () => {
  it("tries the given handlers before every built-in one", async () => {
    const handler = buildHandler({
      handlers: [
        async (request) =>
          new URL(request.url).pathname === "/auth/me"
            ? new Response("mine", { status: 200 })
            : undefined,
      ],
    });

    const response = await handler(new Request("http://localhost/auth/me"));
    expect(await response.text()).toBe("mine");
  });

  it("lets them shadow a built-in route, since a guard is only a guard if it runs first", async () => {
    const handler = buildHandler({
      handlers: [async () => new Response(null, { status: 401 })],
    });

    const response = await handler(new Request("http://localhost/collections/services"));
    expect(response.status).toBe(401);
  });

  it("falls through to the built-in handlers when they all decline", async () => {
    const handler = buildHandler({
      handlers: [async () => undefined],
    });

    const response = await handler(new Request("http://localhost/collections/services"));
    expect(response.status).toBe(200);
  });
});
