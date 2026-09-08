import type { CollectionSchema, GlobalSchema } from "@shuri/core";
import {
  createHookRegistry,
  UnknownCollectionError,
  UnknownGlobalError,
  type Store,
} from "@shuri/store";
import type { StoreEvent } from "./event.js";
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
 * Fake `{ store }` declaring the given collections and globals (one "services" collection and one
 * "site" global by default), over a real `createHookRegistry` — faking the registry would buy
 * nothing and would stop the tests from exercising the delivery the handler depends on. Each
 * resolved store carries its `schema`, like a real one, so the visibility layer can read it. Tests
 * produce events with `emit`, which runs the registered hooks the way a real write would.
 * @param [collections] - The collection schemas the fake store resolves.
 * @param [globals] - The global schemas the fake store resolves.
 * @returns A fake realtime app, with its hook registry exposed for tests to emit through.
 */
export function createFakeRealtimeApp(
  collections: readonly CollectionSchema[] = [servicesSchema],
  globals: readonly GlobalSchema[] = [siteSettingsSchema],
): RealtimeApp {
  const hooks = createHookRegistry();
  const collectionsBySlug = new Map(
    collections.map((schema) => [schema.slug, { schema }]),
  );
  const globalsBySlug = new Map(globals.map((schema) => [schema.slug, { schema }]));
  const store = {
    hooks,
    collection: (slug: string) => {
      const collection = collectionsBySlug.get(slug);
      if (!collection) throw new UnknownCollectionError(slug);
      return collection;
    },
    global: (slug: string) => {
      const global = globalsBySlug.get(slug);
      if (!global) throw new UnknownGlobalError(slug);
      return global;
    },
  } as unknown as Store;
  return { store };
}

/**
 * Runs the after hooks a real write of `event` would run, so whatever `subscribeToChanges`
 * registered on the app's registry sees it exactly as it would see the write.
 * @param app - The fake app whose registry the hooks are looked up on.
 * @param event - The event to produce.
 * @returns Nothing; resolves once every registered hook has run.
 */
export async function emit(app: RealtimeApp, event: StoreEvent): Promise<void> {
  const context = {};
  if (event.scope === "global") {
    for (const hook of app.store.hooks.globalHooks(event.global, "afterChange")) {
      await hook({ global: event.global, context, doc: event.record, previousDoc: {} });
    }
    return;
  }
  if (event.type === "delete") {
    for (const hook of app.store.hooks.collectionHooks(event.collection, "afterDelete")) {
      await hook({ collection: event.collection, context, id: event.id });
    }
    return;
  }
  for (const hook of app.store.hooks.collectionHooks(event.collection, "afterChange")) {
    await hook(
      event.type === "create"
        ? {
            collection: event.collection,
            context,
            operation: "create",
            doc: event.record,
          }
        : {
            collection: event.collection,
            context,
            operation: "update",
            doc: event.record,
            previousDoc: event.record,
          },
    );
  }
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
