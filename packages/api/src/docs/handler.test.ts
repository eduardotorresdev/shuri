import { createCore } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { servicesSchema } from "../collections/test-support.js";
import { createOpenApiHandler } from "./handler.js";

function createApp() {
  return { core: createCore({ collections: [servicesSchema] }) };
}

describe("createOpenApiHandler", () => {
  it("serves the OpenAPI document as JSON at the default spec path", async () => {
    const handler = createOpenApiHandler(createApp());

    const response = await handler(new Request("http://localhost/openapi.json"));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("application/json");
    const body = (await response?.json()) as { paths: Record<string, unknown> };
    expect(body.paths["/collections/services"]).toBeDefined();
  });

  it("serves an HTML docs page pointing at the spec path", async () => {
    const handler = createOpenApiHandler(createApp());

    const response = await handler(new Request("http://localhost/docs"));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("text/html");
    expect(await response?.text()).toContain('data-url="/openapi.json"');
  });

  it("returns undefined for unrelated paths, so it falls through to another handler", async () => {
    const handler = createOpenApiHandler(createApp());

    const response = await handler(new Request("http://localhost/collections/services"));

    expect(response).toBeUndefined();
  });

  it("respects custom specPath/docsPath", async () => {
    const handler = createOpenApiHandler(createApp(), {
      specPath: "/api/spec.json",
      docsPath: "/api/docs",
    });

    const specResponse = await handler(new Request("http://localhost/api/spec.json"));
    const docsResponse = await handler(new Request("http://localhost/api/docs"));

    expect(specResponse?.status).toBe(200);
    expect(docsResponse?.status).toBe(200);
    expect(await docsResponse?.text()).toContain('data-url="/api/spec.json"');
  });
});
