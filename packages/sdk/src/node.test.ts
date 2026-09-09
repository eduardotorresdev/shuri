import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createMemoryAdapter } from "@shuri/store-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "./create.js";
import { toNodeListener } from "./node.js";

const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [{ type: "text", name: "title", required: true }],
  },
] as const;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

const noop = (): void => {};

/**
 * A promise settled from the outside, standing in for `Promise.withResolvers` (ES2024).
 * @returns The promise and the function that resolves it.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  const holder = { resolve: noop };
  const promise = new Promise<void>((resolve) => {
    holder.resolve = resolve;
  });
  return { promise, resolve: () => holder.resolve() };
}

let app: ReturnType<typeof buildApp>;
let server: Server;
let baseUrl: string;

function buildApp() {
  return create({
    collections,
    adapter: createMemoryAdapter(),
    realtime: { heartbeatMs: 0 },
  });
}

beforeEach(async () => {
  app = buildApp();
  server = createServer(toNodeListener(app));
  baseUrl = await listen(server);
});

afterEach(async () => {
  await close(server);
});

describe("toNodeListener", () => {
  it("serves a GET as JSON off app.handler", async () => {
    const inserted = await app.collections.posts.insert({ title: "Hello" });

    const response = await fetch(`${baseUrl}/collections/posts/${inserted.id}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual(inserted);
  });

  it("sends a single-chunk body with Content-Length, not chunked", async () => {
    const inserted = await app.collections.posts.insert({ title: "Sized" });

    const response = await fetch(`${baseUrl}/collections/posts/${inserted.id}`);
    const body = await response.text();

    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(body)));
    expect(response.headers.get("transfer-encoding")).toBeNull();
    expect(JSON.parse(body)).toEqual(inserted);
  });

  it("streams a multi-chunk body without waiting for the end", async () => {
    let release!: () => void;
    const listener = toNodeListener({
      handler: async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("first"));
            release = () => {
              controller.enqueue(encoder.encode("second"));
              controller.close();
            };
          },
        });
        return new Response(stream, { headers: { "content-type": "text/plain" } });
      },
    });
    const streamServer = createServer(listener);
    const url = await listen(streamServer);
    try {
      const response = await fetch(url);
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe("first");
      expect(response.headers.get("content-length")).toBeNull();

      release();
      const second = await reader.read();
      expect(new TextDecoder().decode(second.value)).toBe("second");
      expect((await reader.read()).done).toBe(true);
    } finally {
      await close(streamServer);
    }
  });

  it("delivers a POST body to app.handler", async () => {
    const response = await fetch(`${baseUrl}/collections/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Posted" }),
    });

    expect(response.status).toBe(201);
    const [record] = await app.collections.posts.findMany();
    expect(record?.title).toBe("Posted");
  });

  it("keeps several Set-Cookie headers apart", async () => {
    const listener = toNodeListener({
      handler: async () => {
        const headers = new Headers();
        headers.append("set-cookie", "a=1; Path=/");
        headers.append("set-cookie", "b=2; Path=/");
        return new Response(null, { status: 204, headers });
      },
    });
    const cookieServer = createServer(listener);
    const url = await listen(cookieServer);
    try {
      const response = await fetch(url);
      expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    } finally {
      await close(cookieServer);
    }
  });

  it("streams an event frame as soon as a write lands", async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/events?collection=posts`, {
      signal: controller.signal,
    });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    const inserted = await app.collections.posts.insert({ title: "Streamed" });
    const { value } = await reader.read();
    const frame = new TextDecoder().decode(value);

    expect(frame).toContain("event: create\n");
    expect(frame).toContain(`"id":"${inserted.id}"`);
    controller.abort();
  });

  it("aborts the request signal when the client closes the connection", async () => {
    let aborted = false;
    const { promise: opened, resolve: markOpened } = deferred();
    const listener = toNodeListener({
      handler: async (request) => {
        request.signal.addEventListener("abort", () => (aborted = true));
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello\n"));
            markOpened();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/plain" } });
      },
    });
    const streamServer = createServer(listener);
    const url = await listen(streamServer);
    try {
      const controller = new AbortController();
      const response = await fetch(url, { signal: controller.signal });
      await opened;
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();

      controller.abort();
      await expect.poll(() => aborted).toBe(true);
    } finally {
      await close(streamServer);
    }
  });
});
