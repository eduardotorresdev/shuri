import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "../collections.js";
import { createClient } from "../create.js";
import { ClientError } from "../errors.js";
import type { GlobalEvent } from "../globals.js";
import type { RealtimeMessage } from "../realtime/subscribe.js";
import { collect, createTestApp, opened } from "./support.js";

const unsubscribes: (() => void)[] = [];

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
});

describe("client realtime", () => {
  it("streams a collection's writes, typed from the schema", async () => {
    const { app, client } = createTestApp();
    const { listener, events } = collect<CollectionEvent<{ title: string }>>(3);
    const { onOpen, open } = opened();
    unsubscribes.push(client.collections.posts.subscribe(listener, { onOpen }));
    await open;

    const post = await app.collections.posts.insert({ title: "Hello" });
    await app.collections.posts.update(post.id, { title: "Hello again" });
    await app.collections.posts.delete(post.id);

    const received = await events;
    expect(received).toEqual([
      { type: "create", collection: "posts", id: post.id, record: post },
      {
        type: "update",
        collection: "posts",
        id: post.id,
        record: { ...post, title: "Hello again" },
      },
      { type: "delete", collection: "posts", id: post.id },
    ]);
    const [first] = received;
    if (first.type !== "delete") {
      const title: string = first.record.title;
      expect(title).toBe("Hello");
    }
  });

  it("narrows the selection to one record and to some event types", async () => {
    const { app, client } = createTestApp();
    const watched = await app.collections.posts.insert({ title: "Watched" });
    const { listener, events } = collect<CollectionEvent<{ title: string }>>(1);
    const { onOpen, open } = opened();
    unsubscribes.push(
      client.collections.posts.subscribe(listener, {
        id: watched.id,
        events: ["delete"],
        onOpen,
      }),
    );
    await open;

    const other = await app.collections.posts.insert({ title: "Other" });
    await app.collections.posts.update(watched.id, { title: "Still watched" });
    await app.collections.posts.delete(other.id);
    await app.collections.posts.delete(watched.id);

    expect(await events).toEqual([
      { type: "delete", collection: "posts", id: watched.id },
    ]);
  });

  it("streams a global's updates, and the raw stream everything", async () => {
    const { app, client } = createTestApp();
    const site = collect<GlobalEvent<{ name: string }>>(1);
    const raw = collect<RealtimeMessage>(2);
    const siteOpen = opened();
    const rawOpen = opened();
    unsubscribes.push(
      client.globals.site.subscribe(site.listener, { onOpen: siteOpen.onOpen }),
    );
    unsubscribes.push(
      client.realtime.subscribe({}, raw.listener, { onOpen: rawOpen.onOpen }),
    );
    await Promise.all([siteOpen.open, rawOpen.open]);

    await app.collections.posts.insert({ title: "Hello" });
    await app.globals.site.update({ name: "Acme" });

    expect(await site.events).toEqual([
      { type: "update", global: "site", record: { name: "Acme" } },
    ]);
    expect((await raw.events).map((message) => message.type)).toEqual([
      "create",
      "update",
    ]);
  });

  it("reports a refused selection through onError and does not retry", async () => {
    const { client } = createTestApp();
    const onError = vi.fn();
    let opens = 0;
    unsubscribes.push(
      client.realtime.subscribe({ collection: ["nope"] }, () => {}, {
        onError,
        onOpen: () => (opens += 1),
        retryDelayMs: 0,
      }),
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());

    expect(onError.mock.calls[0][0]).toBeInstanceOf(ClientError);
    expect(onError.mock.calls[0][0]).toMatchObject({ status: 404 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(opens).toBe(0);
  });

  it("reconnects after a network drop, with the token it holds", async () => {
    const { app } = createTestApp();
    let attempts = 0;
    const client = createClient<typeof app.schema>({
      baseUrl: "http://localhost",
      token: "sct_whatever",
      fetch: (input, init) => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new TypeError("fetch failed"));
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer sct_whatever",
        );
        return app.handler(new Request(input, init));
      },
    });
    const onError = vi.fn();
    const { listener, events } = collect<CollectionEvent<{ title: string }>>(1);
    const { onOpen, open } = opened();
    unsubscribes.push(
      client.collections.posts.subscribe(listener, { onError, onOpen, retryDelayMs: 0 }),
    );
    await open;

    const post = await app.collections.posts.insert({ title: "After the drop" });

    expect(await events).toEqual([
      { type: "create", collection: "posts", id: post.id, record: post },
    ]);
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError));
    expect(attempts).toBe(2);
  });

  it("ends the subscription through the returned function or the signal", async () => {
    const { app, client } = createTestApp();
    const seen: string[] = [];
    const controller = new AbortController();
    const first = opened();
    const second = opened();
    const unsubscribe = client.collections.posts.subscribe(
      (event) => seen.push(`a:${event.type}`),
      { onOpen: first.onOpen },
    );
    client.collections.posts.subscribe((event) => seen.push(`b:${event.type}`), {
      signal: controller.signal,
      onOpen: second.onOpen,
    });
    await Promise.all([first.open, second.open]);

    unsubscribe();
    controller.abort();
    await app.collections.posts.insert({ title: "Unseen" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(seen).toEqual([]);
  });
});
