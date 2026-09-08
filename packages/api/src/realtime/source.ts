import type { HookRegistry, Unsubscribe } from "@shuri/store";
import type { StoreEvent } from "./event.js";

/**
 * Feeds `listener` with one `StoreEvent` per accepted write, from wildcard `afterChange`/
 * `afterDelete` hooks on every collection and `afterChange` on every global — the same way
 * PocketBase's realtime is built on its record hooks. Registered on `"*"`, the hooks run after each
 * slug's own, so what reaches the stream is the write as every schema-declared hook left it.
 *
 * A throwing `listener` never fails the write that produced the event (an _after_ hook that throws
 * would otherwise propagate to the writer): the error is rethrown out of band, in a microtask, so it
 * still surfaces at the host's error boundary instead of being swallowed.
 * @param hooks - The registry of the store whose writes are observed.
 * @param listener - Receives one event per write, synchronously with the hook chain.
 * @returns Unregisters every hook this call registered.
 */
export function subscribeToChanges(
  hooks: HookRegistry,
  listener: (event: StoreEvent) => void,
): Unsubscribe {
  const deliver = (event: StoreEvent): void => {
    try {
      listener(event);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  };

  const unsubscribes = [
    hooks.onCollection("*", "afterChange", ({ collection, operation, doc }) =>
      deliver({
        scope: "collection",
        type: operation,
        collection,
        id: doc.id,
        record: doc,
      }),
    ),
    hooks.onCollection("*", "afterDelete", ({ collection, id }) =>
      deliver({ scope: "collection", type: "delete", collection, id }),
    ),
    hooks.onGlobal("*", "afterChange", ({ global, doc }) =>
      deliver({ scope: "global", type: "update", global, record: doc }),
    ),
  ];

  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
