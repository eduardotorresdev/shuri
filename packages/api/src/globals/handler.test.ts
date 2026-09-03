import { describe, expect, it } from "vitest";
import { createGlobalsApiHandler } from "./handler.js";
import { createFakeGlobalsApp } from "./test-support.js";

describe("createGlobalsApiHandler", () => {
  it("dispatches GET on the global path to get()", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp());
    const response = await handler(new Request("http://localhost/globals/site"));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({});
  });

  it("dispatches PATCH on the global path to update()", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp());
    const response = await handler(
      new Request("http://localhost/globals/site", {
        method: "PATCH",
        body: JSON.stringify({ name: "Acme" }),
      }),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ name: "Acme" });
  });

  it("reflects an update on a subsequent get", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp());
    await handler(
      new Request("http://localhost/globals/site", {
        method: "PATCH",
        body: JSON.stringify({ name: "Acme" }),
      }),
    );

    const response = await handler(new Request("http://localhost/globals/site"));
    expect(await response?.json()).toEqual({ name: "Acme" });
  });

  it("returns undefined for a path outside basePath, so it falls through to another handler", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp());
    const response = await handler(new Request("http://localhost/other"));
    expect(response).toBeUndefined();
  });

  it("returns 404 for an unknown global slug", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp());
    const response = await handler(new Request("http://localhost/globals/unknown"));
    expect(response?.status).toBe(404);
  });

  it("returns 405 for an unsupported method", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp());
    const response = await handler(
      new Request("http://localhost/globals/site", { method: "POST" }),
    );
    expect(response?.status).toBe(405);
  });

  it("returns 400 for an invalid JSON body", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp());
    const response = await handler(
      new Request("http://localhost/globals/site", {
        method: "PATCH",
        body: "not json",
      }),
    );
    expect(response?.status).toBe(400);
  });

  it("respects a custom basePath", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp(), {
      basePath: "/api-globals",
    });
    const response = await handler(new Request("http://localhost/api-globals/site"));
    expect(response?.status).toBe(200);
  });

  it("returns undefined for a path with an extra segment", async () => {
    const handler = createGlobalsApiHandler(createFakeGlobalsApp());
    const response = await handler(new Request("http://localhost/globals/site/extra"));
    expect(response).toBeUndefined();
  });
});
