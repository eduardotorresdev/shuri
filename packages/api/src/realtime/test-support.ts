import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import {
  createEventBus,
  UnknownCollectionError,
  UnknownGlobalError,
  type Store,
} from "@shuri/store";
import type { RealtimeApp } from "./handler.js";

/** Test-only fixtures for this package's realtime tests, kept independent of `@shuri/sdk`. */
export const servicesSchema: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [{ type: "text", name: "name", required: true }],
};

export const siteSettingsSchema: GlobalSchema = {
  slug: "site",
  title: "Site settings",
  category: { title: "Geral" },
  fields: [{ type: "text", name: "name", required: true }],
};

/**
 * Fake `{ store }` declaring one "services" collection and one "site" global, over a real
 * `createEventBus` — faking a four-line bus would buy nothing and would stop the tests from
 * exercising the delivery the handler depends on.
 * @returns A fake realtime app, with its bus exposed for tests to emit on.
 */
export function createFakeRealtimeApp(): RealtimeApp {
  const events = createEventBus();
  const store = {
    events,
    collection: (slug: string) => {
      if (slug !== servicesSchema.slug) throw new UnknownCollectionError(slug);
      return {};
    },
    global: (slug: string) => {
      if (slug !== siteSettingsSchema.slug) throw new UnknownGlobalError(slug);
      return {};
    },
  } as unknown as Store;
  return { store };
}

/** One SSE message, as read back off a stream. */
export interface ReadEvent {
  event: string;
  data: unknown;
}

/**
 * Reads exactly `count` messages off an SSE response, skipping keep-alive comments, then cancels the
 * body. Call it *before* awaiting whatever produces the events: the subscription is already live
 * when the handler resolves, so the read can start first and the write can't be missed.
 * @param response - The streaming response to read.
 * @param count - How many messages to read before resolving.
 * @returns The messages read, in arrival order.
 */
export async function readEvents(
  response: Response,
  count: number,
): Promise<ReadEvent[]> {
  if (!response.body) throw new Error("expected a streaming body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const messages: ReadEvent[] = [];
  let buffer = "";

  try {
    while (messages.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const message = parseMessage(chunk);
        if (message) messages.push(message);
      }
    }
  } finally {
    await reader.cancel();
  }

  return messages;
}

function parseMessage(chunk: string): ReadEvent | undefined {
  if (chunk === "" || chunk.startsWith(":")) return undefined;

  const lines = chunk.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
  const data = lines.find((line) => line.startsWith("data: "))?.slice("data: ".length);
  if (event === undefined || data === undefined) return undefined;

  return { event, data: JSON.parse(data) as unknown };
}
