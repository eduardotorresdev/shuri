import type { StoreEvent, StoreEventListener, Unsubscribe } from "./types.js";

/**
 * Publish/subscribe hub every write in this package emits to. Declared as an interface, not a class,
 * so a multi-process deployment can swap the in-process implementation below for one backed by
 * Redis/NATS without touching a single call site — the current scope is in-process only.
 */
export interface StoreEventBus {
  emit(event: StoreEvent): void;
  subscribe(listener: StoreEventListener<StoreEvent>): Unsubscribe;
}

/**
 * Creates an in-process event bus delivering every emitted event synchronously to every subscriber.
 * @returns A `StoreEventBus` backed by an in-memory set of listeners.
 */
export function createEventBus(): StoreEventBus {
  const listeners = new Set<StoreEventListener<StoreEvent>>();

  return {
    emit(event) {
      // Iterates a snapshot: a listener that unsubscribes mid-dispatch (an SSE client disconnecting,
      // say) mutates the set, and a live iterator would silently skip the listeners after it.
      const snapshot = [...listeners];
      for (const listener of snapshot) {
        try {
          listener(event);
        } catch (error) {
          // A failing listener must not fail the write that produced the event, but it must not be
          // swallowed either: rethrowing out of band surfaces it at the host's error boundary, the
          // same way `toErrorResponse` rethrows what it doesn't recognize.
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
