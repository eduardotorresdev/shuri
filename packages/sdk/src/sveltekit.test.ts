import { describe, expect, it, vi } from "vitest";
import { toSvelteKitHandle } from "./sveltekit.js";

function makeEvent(pathname: string) {
  return { request: new Request(`http://localhost${pathname}`), url: new URL(`http://localhost${pathname}`) };
}

describe("toSvelteKitHandle", () => {
  it("routes a request under the base path to app.handler", async () => {
    const handler = vi.fn(async () => new Response("from shuri"));
    const resolve = vi.fn(async () => new Response("from sveltekit"));
    const handle = toSvelteKitHandle({ handler });

    const response = await handle({ event: makeEvent("/api/collections/posts"), resolve });

    expect(await response.text()).toBe("from shuri");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("routes a request exactly matching the base path to app.handler", async () => {
    const handler = vi.fn(async () => new Response("from shuri"));
    const resolve = vi.fn(async () => new Response("from sveltekit"));
    const handle = toSvelteKitHandle({ handler });

    await handle({ event: makeEvent("/api"), resolve });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("falls through to resolve for requests outside the base path", async () => {
    const handler = vi.fn(async () => new Response("from shuri"));
    const resolve = vi.fn(async () => new Response("from sveltekit"));
    const handle = toSvelteKitHandle({ handler });

    const response = await handle({ event: makeEvent("/about"), resolve });

    expect(await response.text()).toBe("from sveltekit");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not treat a path merely prefixed by base as a match", async () => {
    const handler = vi.fn(async () => new Response("from shuri"));
    const resolve = vi.fn(async () => new Response("from sveltekit"));
    const handle = toSvelteKitHandle({ handler });

    await handle({ event: makeEvent("/api-docs"), resolve });

    expect(handler).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("honors a custom base option", async () => {
    const handler = vi.fn(async () => new Response("from shuri"));
    const resolve = vi.fn(async () => new Response("from sveltekit"));
    const handle = toSvelteKitHandle({ handler }, { base: "/backend" });

    await handle({ event: makeEvent("/backend/events"), resolve });
    await handle({ event: makeEvent("/api/events"), resolve });

    expect(handler).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
  });
});
