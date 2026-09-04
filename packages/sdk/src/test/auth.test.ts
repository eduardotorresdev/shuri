import { createMemoryAdapter } from "@shuri/store-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "../create.js";

/**
 * End-to-end coverage of an app with auth turned on: one `create()` call, one store, one handler —
 * the auth routes, the REST routes and the event stream all served off it.
 */
const collections = [
  {
    slug: "posts",
    title: "Posts",
    singular: "Post",
    plural: "Posts",
    fields: [{ type: "text", name: "title", required: true }],
  },
] as const;

let app: ReturnType<typeof buildApp>;
let controller: AbortController;

function buildApp() {
  return create({
    collections,
    adapter: createMemoryAdapter(),
    auth: { cookie: { secure: false } },
    realtime: { heartbeatMs: 0 },
  });
}

beforeEach(() => {
  app = buildApp();
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
});

const credentials = { email: "ada@example.com", password: "correct-horse-battery" };

function post(path: string, body?: unknown, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `shuri_session=${cookie}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") as string;
  return decodeURIComponent(header.slice("shuri_session=".length).split(";")[0]);
}

describe("an app with auth", () => {
  it("signs up, reads the session back, signs out and signs in again over HTTP", async () => {
    const signup = await app.handler(post("/auth/signup", credentials));
    expect(signup.status).toBe(201);
    const cookie = sessionCookie(signup);

    const me = await app.handler(
      new Request("http://localhost/auth/me", {
        headers: { cookie: `shuri_session=${cookie}` },
      }),
    );
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(
      "ada@example.com",
    );

    expect((await app.handler(post("/auth/logout", undefined, cookie))).status).toBe(204);
    expect((await app.handler(post("/auth/login", credentials))).status).toBe(200);
  });

  it("keeps the auth collections out of the OpenAPI document", async () => {
    const document = (await (
      await app.handler(new Request("http://localhost/openapi.json"))
    ).json()) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };

    expect(Object.keys(document.paths)).toContain("/collections/posts");
    expect(Object.keys(document.paths).join(" ")).not.toContain("users");
    expect(document.components.schemas["users"]).toBeUndefined();
    expect(document.components.schemas["_sessions"]).toBeUndefined();
  });

  it("never streams an auth write, while ordinary collections still stream", async () => {
    const response = await app.handler(
      new Request("http://localhost/events", { signal: controller.signal }),
    );
    const frames = readFrames(response, 1);

    // The signup writes a user and a session; if the first frame to arrive is the post's, neither
    // produced one. Asserting absence in a live stream any other way is a race.
    await app.handler(post("/auth/signup", credentials));
    const created = await app.collections.posts.insert({ title: "Hello" });

    expect(await frames).toEqual([
      { event: "create", data: { collection: "posts", id: created.id, record: created } },
    ]);
  });
});

async function readFrames(
  response: Response,
  count: number,
): Promise<{ event: string; data: unknown }[]> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const frames: { event: string; data: unknown }[] = [];
  let buffer = "";

  try {
    while (frames.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const event = chunk.match(/^event: (.*)$/m)?.[1];
        const data = chunk.match(/^data: (.*)$/m)?.[1];
        if (event && data) frames.push({ event, data: JSON.parse(data) as unknown });
      }
    }
  } finally {
    await reader.cancel();
  }
  return frames;
}
