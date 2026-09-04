import type { GlobalSchema } from "@shuri/core";
import type { StoreAdapter } from "../adapter.js";
import type { StoreEventBus } from "../events/bus.js";
import type { GlobalEvent, StoreEventListener, Unsubscribe } from "../events/types.js";
import type { RecordInput } from "../record.js";
import { assertValidRecord } from "../validate-record.js";

/**
 * Persistence operations scoped to a single global: get and update the one record. Like
 * `CollectionStore`, this is the complete view: it carries `schema` (`hidden` fields included) and
 * never applies the flag itself.
 */
export interface GlobalStore<R = RecordInput> {
  /** The schema this store was bound to, so the HTTP layer can read visibility metadata off it. */
  readonly schema: GlobalSchema;
  /** Always resolves — to `{}` until the first `update`. */
  get(): Promise<R>;
  update(data: Partial<R>): Promise<R>;
  /** Subscribes to this global's updates. Returns the unsubscribe function. */
  subscribe(listener: StoreEventListener<GlobalEvent<R>>): Unsubscribe;
}

/**
 * Binds one global's get/update to `adapter`, publishing every accepted update to `events`.
 * Emission happens after the adapter resolves and before the caller's `await` does, so an update
 * that throws emits nothing and every listener has already run once `await update(...)` returns.
 * @param global - The schema of the global being bound.
 * @param adapter - The persistence adapter backing the global.
 * @param events - The bus every accepted update is published to.
 * @returns The `GlobalStore` for `global`.
 */
export function bindGlobal(
  global: GlobalSchema,
  adapter: StoreAdapter,
  events: StoreEventBus,
): GlobalStore {
  return {
    schema: global,
    async get() {
      const record = await adapter.findGlobal(global);
      return record ?? {};
    },
    async update(data) {
      assertValidRecord(global, data, { partial: true });
      const record = await adapter.updateGlobal(global, data);
      events.emit({ scope: "global", type: "update", global: global.slug, record });
      return record;
    },
    subscribe(listener) {
      return events.subscribe((event) => {
        if (event.scope === "global" && event.global === global.slug) listener(event);
      });
    },
  };
}
